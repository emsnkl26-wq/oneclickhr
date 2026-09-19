import 'server-only'

/**
 * ONE FUNNEL. Every notification this product raises goes through here, and
 * here is the only place that decides who receives it and on which channels.
 *
 * Before 035 there were three ways a person could be told something — the
 * announcements composer, `notifyEmployee`, and the visa cron writing its own
 * row — and each of them had its own opinion about email. Adding browser push
 * to three places would have made three subsystems that agree today and drift by
 * the next feature. So the fan-out moved here and the three call sites kept
 * their signatures.
 *
 * THE ORDER OF OPERATIONS IS THE CONTRACT, and it is worth stating because it
 * is what makes this safe to call from inside a route that has already changed
 * something:
 *
 *   1. The row is written FIRST, by the caller, under RLS, with the caller's own
 *      client. That is the delivery that must not be lost — it is the one the
 *      product can still show tomorrow — and it is the only step whose failure
 *      the caller hears about.
 *   2. Fan-out happens afterwards and NEVER THROWS. A push service being down,
 *      Resend rejecting a domain, the admin client being unavailable — none of
 *      these may roll back an approved timesheet or a posted announcement. They
 *      are logged and returned as counts.
 *
 * AUDIENCE IS RESOLVED HERE AND ONLY HERE, and it deliberately mirrors what
 * `notifications_select` (002) will let each person read. If the two disagree,
 * somebody gets a push for a notification that is not in their list when they
 * tap it — which reads as the product losing their message.
 *
 * WHY THE ADMIN CLIENT. Delivering means reading OTHER PEOPLE's email addresses
 * and push keys; under the caller's client, RLS correctly returns nothing (an
 * employee cannot enumerate their colleagues, and `push_subscriptions` is
 * self-only even for an admin). Every query below is therefore scoped by an
 * explicit `tenant_id` that came from the SESSION — see the header of
 * src/lib/supabase/admin.ts — and `assertTenantScope` turns a missing one into a
 * throw rather than a cross-tenant read.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { sendPushToUsers, usersWithSubscriptions, isPushConfigured } from '@/lib/push/send'
import { sendNotificationEmail, isEmailConfigured } from '@/lib/email'
import { isExternalImage } from '@/lib/notification-image'
import {
  importanceFor,
  pathFor,
  tagFor,
  type NotificationEvent,
  type NotificationImportance,
} from '@/lib/notifications/events'
import type { UserRole } from '@/types/db'

export type { NotificationEvent, NotificationImportance }

export type Audience =
  | { type: 'all' }
  | { type: 'department'; targetId: string }
  | { type: 'employee'; targetId: string }

export interface DeliverArgs {
  /** The row that was just written. Its id keys the delivery ledger. */
  notificationId: string
  tenantId: string
  audience: Audience
  title: string
  description?: string | null
  /** An R2 key or an external https:// URL. Filtered per channel — see below. */
  imageUrl?: string | null
  event?: NotificationEvent
  /** Overrides the catalog. Used only by the composer's "also email" checkbox. */
  importance?: NotificationImportance
  /**
   * Whoever caused this. NEVER notified about their own action: an admin who
   * posts an announcement does not need their phone to buzz about it, and a
   * reply notification that reaches its own author looks like a bug.
   */
  actorId?: string | null
  /** The entity this is about (ticket id, task id) — feeds the push `tag`. */
  subjectId?: string | null
}

export interface DeliveryReport {
  recipients: number
  /** People for whom at least one device accepted the push. */
  pushed: number
  /** People sent an email copy. */
  emailed: number
  errors: string[]
}

const emptyReport = (): DeliveryReport => ({ recipients: 0, pushed: 0, emailed: 0, errors: [] })

interface Recipient {
  id: string
  email: string | null
  role: UserRole
}

/**
 * Who can see this notification, minus the person who caused it.
 *
 * Mirrors `notifications_select`, with one narrowing that is intentional rather
 * than an oversight: for an `all` or `department` announcement the deliverable
 * audience is the EMPLOYEES it was addressed to, not every administrator in the
 * workspace who can also read it. Administrators can read everything in their
 * tenant under that policy — including notices they wrote for someone else —
 * and treating "can read" as "should be pushed" would have every admin's phone
 * repeat every message the workspace sends. It also keeps the push audience
 * identical to the email audience the composer has always used, so the two
 * channels cannot disagree about who was told.
 *
 * A notification addressed to ONE person is exempt from that narrowing: it goes
 * to exactly that profile whatever their role, which is what makes a task
 * assigned to an administrator reach them.
 */
async function resolveRecipients(
  admin: SupabaseClient,
  tenantId: string,
  audience: Audience,
  actorId: string | null | undefined
): Promise<Recipient[]> {
  let query = admin
    .from('profiles')
    .select('id, email, role')
    // service_role bypasses RLS: this predicate IS the tenant boundary.
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (audience.type === 'employee') {
    query = query.eq('id', audience.targetId)
  } else {
    query = query.eq('role', 'employee')
    if (audience.type === 'department') {
      query = query.eq('department_id', audience.targetId)
    }
  }

  // A workspace this large is already past the point where one push fan-out per
  // request is the right design, but a cap is better than an unbounded read that
  // times out the route that raised the notification.
  const { data, error } = await query.limit(2000)

  if (error) {
    console.error('[notify] could not resolve recipients', error.message)
    return []
  }

  return (data ?? [])
    .filter((row) => row.id !== actorId)
    .map((row) => ({
      id: row.id as string,
      email: (row.email as string | null) ?? null,
      role: (row.role as UserRole) ?? 'employee',
    }))
}

/**
 * Claim a channel for a set of people, and report who was actually claimed.
 *
 * THE RETURN VALUE IS THE WHOLE POINT. `ignoreDuplicates` makes the insert skip
 * rows that already exist and `.select()` returns only the ones it really wrote,
 * so the set that comes back is exactly the set of people who have NOT been
 * delivered to on this channel for this notification. A retried request — a
 * double-clicked Approve, a platform retry after a timeout — claims nothing and
 * therefore sends nothing. The primary key in 035 performs the check, so two
 * concurrent runs cannot both win it.
 *
 * Status is written optimistically as 'sent' and corrected afterwards for the
 * failures. That ordering is deliberate: a claim written after a successful send
 * leaves a window in which a retry duplicates the message, and a duplicate email
 * about someone's pay is a worse outcome than a ledger row that briefly
 * overstates a delivery which is at that moment in flight.
 */
async function claim(
  admin: SupabaseClient,
  notificationId: string,
  tenantId: string,
  channel: 'push' | 'email',
  userIds: string[]
): Promise<string[]> {
  if (!userIds.length) return []

  const { data, error } = await admin
    .from('notification_deliveries')
    .upsert(
      userIds.map((userId) => ({
        notification_id: notificationId,
        user_id: userId,
        tenant_id: tenantId,
        channel,
        status: 'sent' as const,
      })),
      { onConflict: 'notification_id,user_id,channel', ignoreDuplicates: true }
    )
    .select('user_id')

  if (error) {
    /*
     * FAIL OPEN, like the rate limiter.
     *
     * An unreachable ledger is an infrastructure problem; refusing to notify
     * anybody until it comes back would turn a bookkeeping outage into a product
     * outage, and the notification has already been written and is already
     * visible in the portal. The cost of proceeding is a possible duplicate on a
     * retried request; the cost of not proceeding is silence about a rejected
     * timesheet. Deliver, and say so in the log.
     */
    console.error(`[notify] delivery ledger unavailable (${channel}); delivering anyway`, error.message)
    return userIds
  }

  return (data ?? []).map((row) => row.user_id as string)
}

/**
 * Best-effort correction of a claim that did not work out. Never throws.
 *
 * Grouped by REASON rather than issued one statement per person. A fan-out that
 * fails usually fails the same way for everybody — one push service is having a
 * bad minute, or Resend has rejected the sending domain — so the realistic shape
 * is one or two distinct details covering the whole list. Writing a row at a
 * time turned a single bad announcement into hundreds of sequential updates
 * against a table nobody is waiting on.
 */
async function markFailed(
  admin: SupabaseClient,
  notificationId: string,
  channel: 'push' | 'email',
  entries: { userId: string; detail: string }[]
): Promise<void> {
  if (!entries.length) return

  const byDetail = new Map<string, string[]>()
  for (const { userId, detail } of entries) {
    const key = detail.slice(0, 500)
    const list = byDetail.get(key) ?? []
    list.push(userId)
    byDetail.set(key, list)
  }

  try {
    await Promise.all(
      Array.from(byDetail, ([detail, userIds]) =>
        admin
          .from('notification_deliveries')
          .update({ status: 'failed', detail })
          .eq('notification_id', notificationId)
          .eq('channel', channel)
          .in('user_id', userIds)
      )
    )
  } catch (err) {
    console.warn('[notify] could not record delivery failures', err)
  }
}

interface TenantBrand {
  name: string
  primaryColor: string
}

async function loadBrand(admin: SupabaseClient, tenantId: string): Promise<TenantBrand> {
  const { data } = await admin
    .from('tenants')
    .select('name, primary_color')
    .eq('id', tenantId)
    .maybeSingle()

  return {
    name: (data?.name as string) || 'Your workspace',
    primaryColor: (data?.primary_color as string) || '#C41E33',
  }
}

/**
 * Fan a notification that has ALREADY BEEN WRITTEN out to push and email.
 *
 * Never throws. Callers may ignore the result and remain correct.
 */
export async function deliverNotification(args: DeliverArgs): Promise<DeliveryReport> {
  const report = emptyReport()

  try {
    if (!args.notificationId || !args.tenantId) return report

    const importance = importanceFor(args.event, args.importance)
    const pushOn = isPushConfigured()
    const emailOn = importance === 'important' && isEmailConfigured()

    // Nothing to do, and no reason to pay for a recipient query to find out.
    if (!pushOn && !emailOn) return report

    const tenantId = assertTenantScope(args.tenantId)
    const admin = createAdminClient()

    const recipients = await resolveRecipients(admin, tenantId, args.audience, args.actorId)
    report.recipients = recipients.length
    if (!recipients.length) return report

    const targetId = args.subjectId ?? ('targetId' in args.audience ? args.audience.targetId : null)

    /*
     * ONLY THE EXTERNAL KIND TRAVELS.
     *
     * An uploaded image is an R2 key that resolves only through
     * /api/files/view, which authorizes by session cookie. A mail client sends
     * no cookies and a service worker rendering a notification image sends no
     * session either, so in both places an uploaded image renders as a broken
     * one. The in-app notification still shows it — that surface has the session.
     */
    const shareableImage =
      args.imageUrl && isExternalImage(args.imageUrl) ? args.imageUrl : null

    // ---- Push -------------------------------------------------------------
    if (pushOn) {
      /*
       * Only the people who actually have a registered browser. Everyone else is
       * not a failed delivery, they are not a delivery — see the header of
       * `usersWithSubscriptions` for why that distinction is worth a query.
       */
      const reachable = await usersWithSubscriptions(
        tenantId,
        recipients.map((person) => person.id)
      )

      /*
       * Grouped by role because the CLICK TARGET differs by role: the same
       * ticket reply belongs at /employee/helpdesk for one recipient and
       * /org/helpdesk for another, and a push that sends an employee to an /org
       * path lands them on a redirect to their own dashboard — having lost the
       * thing they tapped.
       */
      const byRole = new Map<UserRole, string[]>()
      for (const person of recipients) {
        if (!reachable.has(person.id)) continue
        const list = byRole.get(person.role) ?? []
        list.push(person.id)
        byRole.set(person.role, list)
      }

      for (const [role, ids] of byRole) {
        const claimed = await claim(admin, args.notificationId, tenantId, 'push', ids)
        if (!claimed.length) continue

        const result = await sendPushToUsers(tenantId, claimed, {
          title: args.title,
          body: args.description ?? '',
          url: pathFor(args.event, role),
          id: args.notificationId,
          tag: tagFor(args.event, targetId),
          image: shareableImage,
        })

        const failures: { userId: string; detail: string }[] = []
        for (const userId of claimed) {
          const outcome = result.byUser.get(userId)
          if (outcome && outcome.sent > 0) {
            report.pushed += 1
          } else {
            failures.push({
              userId,
              detail: outcome?.detail ?? 'no reachable device',
            })
          }
        }
        await markFailed(admin, args.notificationId, 'push', failures)
        report.errors.push(...result.errors.slice(0, 5))
      }
    }

    // ---- Email ------------------------------------------------------------
    if (emailOn) {
      const addressable = recipients.filter((person) => !!person.email)
      const claimed = new Set(
        await claim(
          admin,
          args.notificationId,
          tenantId,
          'email',
          addressable.map((person) => person.id)
        )
      )

      const toSend = addressable.filter((person) => claimed.has(person.id))
      if (toSend.length) {
        const brand = await loadBrand(admin, tenantId)

        /*
         * Chunked because Resend caps recipients per call, and grouped by role
         * first for the same reason the push is: the button in the email points
         * at the recipient's own portal.
         *
         * Everyone in a chunk shares one message, so the addresses are visible
         * to each other in principle — which is fine here and only here: every
         * recipient of a chunk is a colleague in the same workspace, already
         * listed in the same employee directory. A notification addressed to ONE
         * person resolves to a single-element chunk by construction.
         */
        const byRole = new Map<UserRole, Recipient[]>()
        for (const person of toSend) {
          const list = byRole.get(person.role) ?? []
          list.push(person)
          byRole.set(person.role, list)
        }

        for (const [role, people] of byRole) {
          const path = pathFor(args.event, role)
          for (let i = 0; i < people.length; i += 45) {
            const chunk = people.slice(i, i + 45)
            const result = await sendNotificationEmail({
              to: chunk.map((person) => person.email as string),
              title: args.title,
              description: args.description,
              path,
              orgName: brand.name,
              brandColor: brand.primaryColor,
              imageUrl: shareableImage,
            })

            if (result.ok) {
              report.emailed += chunk.length
            } else {
              const detail = result.error ?? 'email delivery failed'
              report.errors.push(detail)
              await markFailed(
                admin,
                args.notificationId,
                'email',
                chunk.map((person) => ({ userId: person.id, detail }))
              )
            }
          }
        }
      }
    }
  } catch (err) {
    // The last line of defence. Nothing in a courtesy channel may escape into a
    // business flow that has already committed its real work.
    console.error('[notify] delivery failed', err)
    report.errors.push(err instanceof Error ? err.message : 'unexpected delivery failure')
  }

  return report
}

export interface RaiseArgs extends Omit<DeliverArgs, 'notificationId'> {
  createdBy?: string | null
}

/** PostgREST/Postgres codes that mean "RLS refused this", and nothing else. */
const RLS_DENIED = new Set(['42501', 'PGRST301'])

/**
 * Write the notification AND deliver it — the whole job, for the callers that
 * are not already writing the row themselves.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THE CALLER'S CLIENT FIRST, THE ADMIN CLIENT ONLY IF RLS REFUSES.       │
 * │                                                                        │
 * │ `notifications_write` requires `app.is_org()`, which is right for the  │
 * │ announcements composer — a notice somebody TYPES is an administrator's │
 * │ prerogative. It is wrong for a notification the SYSTEM raises, and     │
 * │ that mismatch was a live bug: the task board is open to employees      │
 * │ (`apiRequireTenantUser`), so when an employee commented on a card or   │
 * │ assigned one, the insert was refused, `notifyEmployee` swallowed the   │
 * │ error as designed, and the watchers were never told. Silently, and     │
 * │ only for employees — which is exactly the shape of bug that survives   │
 * │ testing by an administrator.                                           │
 * │                                                                        │
 * │ Widening the policy was the wrong fix: "any member may insert a        │
 * │ notification addressed to any colleague" hands every employee a way to │
 * │ put arbitrary text in front of anyone in the workspace. Instead the    │
 * │ org path is unchanged and still proves itself under RLS, and only a    │
 * │ REFUSAL falls through to a service-role insert whose every field the   │
 * │ server controls:                                                       │
 * │                                                                        │
 * │   • `tenant_id` comes from the SESSION (assertTenantScope refuses a    │
 * │     missing one), never from a request body;                           │
 * │   • the audience was derived from a record the caller was already      │
 * │     authorized to act on — the watchers of a card they may comment on; │
 * │   • the title is server-composed, and the only caller-supplied text is │
 * │     a preview of the comment they were just allowed to post.           │
 * │                                                                        │
 * │ The fallback costs one extra round trip on a path that currently       │
 * │ produces nothing at all, and zero on the org path, which never reaches │
 * │ it.                                                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Returns null when the row could not be written — the one failure a caller
 * might want to know about, though none currently do.
 */
export async function raiseNotification(
  supabase: SupabaseClient,
  args: RaiseArgs
): Promise<DeliveryReport | null> {
  try {
    const row = {
      tenant_id: args.tenantId,
      title: args.title.slice(0, 200),
      description: args.description ? args.description.slice(0, 4000) : null,
      send_to_type: args.audience.type,
      target_id: args.audience.type === 'all' ? null : args.audience.targetId,
      image_url: args.imageUrl ?? null,
      importance: importanceFor(args.event, args.importance),
      created_by: args.createdBy ?? null,
      // Persisted (041) so the in-app card can link where the push already
      // does. Without these the notifications page has the words but not the
      // thing they are about.
      event: args.event ?? null,
      subject_id: args.subjectId ?? null,
    }

    let { data, error } = await supabase.from('notifications').insert(row).select('id').single()

    if (error && RLS_DENIED.has(error.code ?? '')) {
      // A member who is allowed to cause this notification but not to write one
      // by hand. See the box above for why this is narrow rather than a widened
      // policy.
      const admin = createAdminClient()
      const retry = await admin
        .from('notifications')
        // Re-asserted rather than reused from `row`: this insert is not under
        // RLS, so the tenant scope has to be proven here or not at all.
        .insert({ ...row, tenant_id: assertTenantScope(args.tenantId) })
        .select('id')
        .single()
      data = retry.data
      error = retry.error
    }

    if (error || !data) {
      console.error('[notify] could not record a notification', error?.message)
      return null
    }

    return await deliverNotification({ ...args, notificationId: data.id as string })
  } catch (err) {
    console.error('[notify] unexpected failure', err)
    return null
  }
}
