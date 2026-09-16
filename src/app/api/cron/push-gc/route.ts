import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk } from '@/lib/api'
import { requireCron } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordCronRun } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Collect dead push subscriptions and expired delivery records. Runs daily.
 *
 * WHY A SWEEP IS NEEDED AT ALL, given that `sendPushToUsers` already deletes an
 * endpoint the moment a push service answers 404 or 410. Because that only
 * catches subscriptions somebody has TRIED to push to, and the ones that rot
 * quietly are exactly the ones nobody pushes to: an employee who left, a browser
 * used once on a shared machine, a device that stopped answering without ever
 * returning a verdict. Each is a row that costs a doomed HTTPS round trip on
 * every future fan-out to that person, and a busy workspace accrues them faster
 * than it sheds them.
 *
 * The thresholds live in SQL (`app.prune_push_subscriptions`, 035) rather than
 * here: 120 days without a browser checking in, or ten consecutive non-fatal
 * failures. A browser re-announces itself on every page load, so 120 days of
 * silence means nobody has opened the product in that browser since the spring —
 * and if they do, the next page load registers them again at no cost. Nothing
 * here is destructive of anything a user would notice.
 *
 * The ledger is trimmed on the same run. It exists to make a RETRY safe and a
 * failure explainable, and neither purpose outlives the notification by more
 * than a quarter; left alone it is the fastest-growing table in the schema, at
 * one row per person per channel per notification.
 *
 * FAILS SAFE. Both sweeps are independent, and a failure in either is reported
 * without preventing the other or failing the run — this is housekeeping, and a
 * table that stays large for one more day costs nothing.
 */
async function handlePOST(request: NextRequest) {
  const denied = await requireCron(request, 'push-gc')
  if (denied) return denied

  const startedAt = Date.now()
  const summary = {
    subscriptionsRemoved: 0,
    deliveriesRemoved: 0,
    errors: [] as string[],
  }

  const admin = createAdminClient()

  // Cross-tenant by necessity — a platform job with no user session. Neither RPC
  // takes a tenant, and neither needs one: staleness is a property of a browser,
  // not of a workspace.
  const { data: subscriptions, error: subscriptionError } = await admin.rpc(
    'prune_push_subscriptions',
    { p_stale_days: 120 }
  )
  if (subscriptionError) {
    summary.errors.push(`subscriptions: ${subscriptionError.message}`)
  } else if (typeof subscriptions === 'number') {
    summary.subscriptionsRemoved = subscriptions
  }

  const { data: deliveries, error: deliveryError } = await admin.rpc(
    'prune_notification_deliveries',
    { p_keep_days: 90 }
  )
  if (deliveryError) {
    summary.errors.push(`deliveries: ${deliveryError.message}`)
  } else if (typeof deliveries === 'number') {
    summary.deliveriesRemoved = deliveries
  }

  const ok = summary.errors.length === 0
  await recordCronRun('push-gc', ok, Date.now() - startedAt, summary)
  return jsonOk({ ok, durationMs: Date.now() - startedAt, ...summary })
}

export const POST = withErrorHandler(handlePOST)
