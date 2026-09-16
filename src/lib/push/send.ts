import 'server-only'

/**
 * Web push delivery — the part that actually talks to Google, Mozilla and Apple.
 *
 * WHY THE SERVICE ROLE. `push_subscriptions` is self-only under RLS (035): a
 * person reads their own browsers and nobody else's. That is the right rule for
 * the API and the wrong one here, because the whole job of this module is to
 * deliver to SOMEBODY ELSE — an org admin approving a timesheet has to reach the
 * employee's phone, and under the caller's client that query returns nothing.
 * So it uses the admin client and pays the price the admin client always
 * charges: every query below is scoped with an explicit `tenant_id` resolved
 * from the SESSION by the caller, never from a request body. `assertTenantScope`
 * makes a missing scope a throw rather than a silent read of every workspace.
 *
 * FAILURE IS NOT AN ERROR HERE. A push is a courtesy attached to something that
 * already happened and already persisted. Nothing in this module throws into a
 * business flow; callers get counts, and the reasons go to the log and to
 * `notification_deliveries`.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ A DEAD SUBSCRIPTION IS DELETED, NOT RETRIED.                           │
 * │                                                                        │
 * │ 404 and 410 from a push service are not transient — they are the       │
 * │ service telling us this endpoint is gone for good (permission revoked, │
 * │ browser data cleared, app uninstalled). 403 means the endpoint was     │
 * │ minted against a DIFFERENT VAPID key than the one we now hold, which   │
 * │ no amount of retrying fixes either.                                    │
 * │                                                                        │
 * │ Left in place, each of these costs one doomed HTTPS round trip per      │
 * │ notification forever, and a busy workspace accumulates them faster      │
 * │ than it sheds them — which is how a push system ends up spending most   │
 * │ of its time talking to browsers that no longer exist. Deleting on the  │
 * │ spot is the only thing that keeps the table a list of REACHABLE         │
 * │ devices. The browser re-subscribes by itself on the next page load.     │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import webpush, { WebPushError } from 'web-push'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { vapidConfig, isPushConfigured } from '@/lib/push/vapid'

export { isPushConfigured }

/**
 * What the service worker receives. Kept deliberately small and flat — see the
 * size note on `encodePayload`.
 */
export interface PushPayload {
  title: string
  body: string
  /** In-app destination for a click. A PATH, never an absolute URL — see below. */
  url: string
  /** Notification id, so the worker can collapse duplicates and mark-as-read. */
  id?: string
  /** Groups replacing notifications on the device (`tag` in the Notification API). */
  tag?: string
  /** An absolute https:// image. An R2 key is useless here: see dispatch.ts. */
  image?: string | null
}

export interface PushResult {
  /** Devices the push service accepted. */
  sent: number
  /** Devices that failed for a reason that may not recur. */
  failed: number
  /** Dead endpoints removed from the table during this call. */
  pruned: number
  /** One short line per failure, for the delivery ledger. Never user-facing. */
  errors: string[]
  /**
   * Per-PERSON outcome, keyed by profile id.
   *
   * The aggregate counts above are about DEVICES, and the delivery ledger is
   * about people — one row per recipient per channel. Without this breakdown
   * dispatch would have to write the same aggregate verdict against everyone in
   * a fan-out, so a single unreachable phone would mark the whole workspace as
   * failed while a single reachable one would mark it as delivered. Neither is
   * true, and the ledger exists precisely so that question can be answered.
   *
   * A person with three browsers counts as reached if ANY of them took it.
   */
  byUser: Map<string, { sent: number; failed: number; pruned: number; detail?: string }>
}

const emptyResult = (): PushResult => ({
  sent: 0,
  failed: 0,
  pruned: 0,
  errors: [],
  byUser: new Map(),
})

interface SubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  failure_count: number
}

/**
 * The push protocol caps an encrypted payload at 4096 bytes, and the aes128gcm
 * encoding adds a fixed 103 bytes of header plus padding on top of the
 * plaintext. Going over does not degrade — the push service rejects the whole
 * message with a 413, so ONE long comment preview silently costs somebody their
 * notification.
 *
 * Rather than trust callers to be brief, the payload is measured after
 * serialization and the body is trimmed until it fits, because the body is the
 * only field here that is both large and safely truncatable: a half-length
 * preview still says who did what, where a trimmed URL leads nowhere and a
 * trimmed title reads as a bug.
 */
const MAX_PLAINTEXT_BYTES = 3600

function encodePayload(payload: PushPayload): string {
  let body = payload.body
  let json = JSON.stringify({ ...payload, body })

  // Each pass removes at least a quarter of what is left, so this converges in
  // a handful of iterations even on a pathological input.
  while (Buffer.byteLength(json, 'utf8') > MAX_PLAINTEXT_BYTES && body.length > 0) {
    const over = Buffer.byteLength(json, 'utf8') - MAX_PLAINTEXT_BYTES
    // `over` counts BYTES and `slice` counts UTF-16 units; cutting by the byte
    // count is therefore an over-estimate, which is the safe direction. The
    // extra 8 keeps a multi-byte character from being the thing that stops
    // convergence.
    const keep = Math.max(0, body.length - Math.max(over, 8))
    body = keep > 1 ? `${body.slice(0, keep - 1)}…` : ''
    json = JSON.stringify({ ...payload, body })
  }

  return json
}

/**
 * Which of these people have at least one registered browser.
 *
 * Asked BEFORE the delivery ledger is claimed, and that ordering is the point.
 * Most people in most workspaces have never turned push on, so claiming the
 * channel for the whole audience first would write one ledger row per person per
 * announcement — the great majority of them recording a failure to reach a
 * device that was never registered. On a 300-person workspace that is 300 rows
 * and 300 follow-up updates per notice, for no information: "this person has no
 * push subscription" is already answerable from `push_subscriptions` itself.
 *
 * One indexed read on (tenant_id, user_id), and the ledger then holds only
 * deliveries that were genuinely attempted.
 */
export async function usersWithSubscriptions(
  tenantId: string,
  userIds: string[]
): Promise<Set<string>> {
  if (!userIds.length || !isPushConfigured()) return new Set()

  try {
    const scoped = assertTenantScope(tenantId)
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('push_subscriptions')
      .select('user_id')
      .eq('tenant_id', scoped)
      .in('user_id', Array.from(new Set(userIds)))

    if (error) {
      console.error('[push] could not check for subscriptions', error.message)
      return new Set()
    }

    return new Set((data ?? []).map((row) => row.user_id as string))
  } catch (err) {
    console.error('[push] could not check for subscriptions', err)
    return new Set()
  }
}

/**
 * Deliver to every browser belonging to `userIds`, within one tenant.
 *
 * Returns counts rather than throwing. A caller that cares logs them; a caller
 * that does not can ignore the result entirely and still be correct.
 */
export async function sendPushToUsers(
  tenantId: string,
  userIds: string[],
  payload: PushPayload
): Promise<PushResult> {
  if (!userIds.length) return emptyResult()

  const config = vapidConfig()
  if (!config) {
    // Not an error state. A deployment without VAPID keys simply has push off,
    // and the in-app notification has already been written by the caller.
    return emptyResult()
  }

  const scoped = assertTenantScope(tenantId)
  const admin = createAdminClient()

  const { data: rows, error } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth, failure_count')
    // service_role bypasses RLS — BOTH predicates are the isolation boundary.
    .eq('tenant_id', scoped)
    .in('user_id', Array.from(new Set(userIds)))

  if (error) {
    console.error('[push] could not load subscriptions', error.message)
    return { ...emptyResult(), failed: 1, errors: [`load: ${error.message}`] }
  }

  const subscriptions = (rows ?? []) as SubscriptionRow[]
  if (!subscriptions.length) return emptyResult()

  const message = encodePayload(payload)
  const result: PushResult = emptyResult()

  const tally = (userId: string, field: 'sent' | 'failed' | 'pruned', detail?: string) => {
    const entry = result.byUser.get(userId) ?? { sent: 0, failed: 0, pruned: 0 }
    entry[field] += 1
    if (detail && !entry.detail) entry.detail = detail
    result.byUser.set(userId, entry)
  }
  const dead: string[] = []
  const flaky: SubscriptionRow[] = []
  const alive: string[] = []

  /*
   * Bounded concurrency, not `Promise.all` over the whole list.
   *
   * An announcement to a 300-person workspace is 300+ endpoints. Firing them
   * all at once opens 300 simultaneous TLS connections from a serverless
   * function that is billed by the millisecond and has a file-descriptor
   * ceiling; in practice the tail of that burst times out and is recorded as a
   * failure against devices that were perfectly reachable. Twelve at a time
   * keeps every request inside its timeout while still finishing a large fan-out
   * in a second or two.
   */
  const CONCURRENCY = 12
  for (let i = 0; i < subscriptions.length; i += CONCURRENCY) {
    const batch = subscriptions.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            message,
            {
              vapidDetails: {
                subject: config.subject,
                publicKey: config.publicKey,
                privateKey: config.privateKey,
              },
              /*
               * Hold it for a day if the device is offline. The default of four
               * weeks is wrong for this product — a "your timesheet was
               * approved" that arrives a fortnight late is confusing rather than
               * useful — and a TTL of 0 (deliver now or discard) would drop every
               * notification aimed at a closed laptop, which is most of them.
               */
              TTL: 60 * 60 * 24,
              // Wake the device. These are decisions people are waiting on, not
              // background sync; `normal` lets a phone defer them indefinitely.
              urgency: 'normal',
              timeout: 10_000,
            }
          )
          result.sent += 1
          tally(sub.user_id, 'sent')
          if (sub.failure_count > 0) alive.push(sub.id)
        } catch (err) {
          const status = err instanceof WebPushError ? err.statusCode : undefined

          // 404/410: endpoint retired by the push service. 403: minted against a
          // different VAPID key. None of the three can succeed on a retry.
          if (status === 404 || status === 410 || status === 403) {
            dead.push(sub.id)
            result.pruned += 1
            tally(sub.user_id, 'pruned', `${status}: subscription gone`)
            return
          }

          result.failed += 1
          flaky.push(sub)
          const detail = err instanceof Error ? err.message : 'unknown push failure'
          const line = `${status ?? 'network'}: ${detail}`.slice(0, 200)
          result.errors.push(line)
          tally(sub.user_id, 'failed', line)
        }
      })
    )
  }

  // --- Bookkeeping. Best-effort: a failed sweep must not fail the send. -----
  if (dead.length) {
    const { error: deleteError } = await admin
      .from('push_subscriptions')
      .delete()
      .eq('tenant_id', scoped)
      .in('id', dead)
    if (deleteError) console.warn('[push] could not prune dead subscriptions', deleteError.message)
  }

  if (flaky.length) {
    // Counted, not deleted. A transient failure is exactly what a retry is for;
    // ten consecutive ones mean something is wrong with the endpoint itself, and
    // `app.prune_push_subscriptions` collects it on the next sweep.
    await Promise.all(
      flaky.map((sub) =>
        admin
          .from('push_subscriptions')
          .update({ failure_count: sub.failure_count + 1 })
          .eq('tenant_id', scoped)
          .eq('id', sub.id)
      )
    ).catch((err) => console.warn('[push] could not record failures', err))
  }

  if (alive.length) {
    // A device that has just delivered is healthy whatever its history; leaving
    // an old count in place would let an endpoint that recovered months ago be
    // swept away by the failure threshold.
    const { error: resetError } = await admin
      .from('push_subscriptions')
      .update({ failure_count: 0 })
      .eq('tenant_id', scoped)
      .in('id', alive)
    if (resetError) console.warn('[push] could not reset failure counts', resetError.message)
  }

  return result
}
