import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { pushSubscriptionSchema } from '@/lib/schemas'
import { isPushConfigured } from '@/lib/push/vapid'

export const dynamic = 'force-dynamic'

/**
 * Register this browser for push, or re-announce one already registered.
 *
 * CALLED ON EVERY PAGE LOAD, by design — see `ensurePushSubscription` on the
 * client. A push subscription is not a durable thing: the browser silently
 * rotates the endpoint, the service worker can be evicted under storage
 * pressure, and a `pushsubscriptionchange` event is not fired reliably by every
 * engine. A system that registers once and trusts the row forever ends up
 * pushing into endpoints that stopped existing weeks ago, which is exactly the
 * failure mode that makes people say push "doesn't work". Re-announcing is the
 * cheap fix: one upsert, and the table is never more than one page load stale.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THE UPSERT TARGETS `endpoint`, NOT (user, device).                     │
 * │                                                                        │
 * │ An endpoint identifies a BROWSER, and browsers get handed between      │
 * │ people: a shared workstation, a colleague signing in on someone's      │
 * │ laptop, one person's account replacing another's in the same profile.  │
 * │ Inserting a second row for the new user would leave the old one in     │
 * │ place and pointing at the same device — so the previous occupant's     │
 * │ payroll notifications would keep arriving on a machine they no longer  │
 * │ use. Taking the row over on conflict is what makes signing in the      │
 * │ thing that transfers the device.                                       │
 * │                                                                        │
 * │ `tenant_id` and `user_id` are overwritten from the SESSION on every    │
 * │ conflict, never from the body, so the takeover cannot be spoofed.      │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * WHY THE ADMIN CLIENT for a row the caller owns. The conflicting row may
 * belong to somebody ELSE (the case above), and RLS on `push_subscriptions` is
 * self-only — so under the caller's client the upsert sees no conflicting row,
 * tries a plain insert, and fails the unique constraint with a 23505 that leaves
 * the stale row exactly where it was. The write is still bounded to the caller:
 * `tenant_id` and `user_id` come from `apiRequireTenantUser()`, and nothing in
 * the body reaches them.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  // Configuration is reported, not thrown. A deployment without VAPID keys has
  // push off; the client asks /api/push/config first and will not normally get
  // here, but a stale tab can, and it should be told plainly rather than 500.
  if (!isPushConfigured()) {
    return jsonError('Push notifications are not configured for this deployment.', 503)
  }

  /*
   * Per USER, not per IP: an office shares one address, and a limit keyed to it
   * would lock a whole team out of registering after a handful of page loads.
   * Sixty an hour is far above the honest ceiling — one page load, one call —
   * while still bounding how fast a compromised session could fill the table.
   */
  const limited = await rateLimit(limitKey('push:subscribe', ctx.userId), 60, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('Too many requests. Please try again shortly.', 429)
  }

  const input = await parseBody(request, pushSubscriptionSchema)
  const admin = createAdminClient()

  const { error } = await admin.from('push_subscriptions').upsert(
    {
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      // Diagnostics only, and bounded. Never parsed, never trusted, never shown
      // to another user — it is there so an operator can tell a dead iOS
      // subscription from a dead Chrome one when a workspace reports silence.
      user_agent: (request.headers.get('user-agent') ?? '').slice(0, 400) || null,
      last_seen_at: new Date().toISOString(),
      // A re-announcement means the browser is alive and holding this endpoint.
      // Whatever it failed to receive while it was asleep is not held against it,
      // or the failure sweep would eventually collect a perfectly good device.
      failure_count: 0,
    },
    { onConflict: 'endpoint' }
  )

  if (error) return jsonError(friendlyDbError(error), 400)

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
