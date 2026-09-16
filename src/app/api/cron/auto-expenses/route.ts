import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk } from '@/lib/api'
import { requireCron } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { recordCronRun } from '@/lib/audit'
import { todayIn, safeTimezone } from '@/lib/time'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Book this month's line for every due recurring expense. Runs daily.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ONCE PER RULE PER MONTH, FOREVER                                         │
 * │                                                                          │
 * │ The guarantee is NOT that this job checks whether it already ran. A      │
 * │ check-then-insert is a race, and two overlapping runs (a retry, a slow   │
 * │ previous invocation, somebody pressing the button) would both pass the   │
 * │ check and both insert. The guarantee is the unique index                 │
 * │ `expenses_recurring_period_uq` on (recurring_id, recurring_period), and  │
 * │ `generate_due_expenses()` inserts with ON CONFLICT DO NOTHING — so the   │
 * │ second run writes nothing and says so.                                   │
 * │                                                                          │
 * │ Running this twice in a day is therefore boring, which is the point: it  │
 * │ can be retried freely and the numbers cannot drift.                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ONE CALL PER DISTINCT TIMEZONE, not one per tenant and not one for the whole
 * platform. "The 1st" has to mean the 1st WHERE THE ORG IS — a workspace in
 * Asia/Kolkata books its rent on its own first of the month, not on UTC's. But
 * the SQL is set-based, so tenants sharing a zone share a statement; a few
 * hundred workspaces are a handful of round trips rather than a few hundred.
 *
 * A duplicated insert is impossible here even though two zones can be on
 * different calendar days: the period is the MONTH, so both dates resolve to
 * the same `recurring_period` and the index decides.
 */
async function handlePOST(request: NextRequest) {
  const denied = await requireCron(request, 'auto-expenses')
  if (denied) return denied

  const startedAt = Date.now()
  const admin = createAdminClient()

  const summary = {
    zones: 0,
    created: 0,
    errors: [] as string[],
  }

  try {
    /*
     * Cross-tenant by necessity — a platform job has no user session. The
     * generated rows still carry the tenant of the rule that made them, and the
     * composite foreign key on `expenses` refuses any pairing that does not
     * already hold.
     */
    const { data: tenants, error } = await admin
      .from('tenants')
      .select('timezone')
      .eq('status', 'active')

    if (error) {
      summary.errors.push(`tenant scan failed: ${error.message}`)
      await recordCronRun('auto-expenses', false, Date.now() - startedAt, summary)
      return jsonOk({ ok: false, ...summary })
    }

    const zones = new Set((tenants ?? []).map((t) => safeTimezone(t.timezone)))
    // A platform with no active tenants should still resolve a date, so the job
    // reports a clean run rather than an empty one that looks like a failure.
    if (zones.size === 0) zones.add('UTC')

    // Distinct DATES, not distinct zones: most of the world shares a calendar
    // day at any given moment, so this usually collapses to one or two calls.
    const dates = new Set([...zones].map((zone) => todayIn(zone)))
    summary.zones = zones.size

    for (const today of dates) {
      const { data, error: rpcError } = await admin.rpc('generate_due_expenses', {
        p_today: today,
      })
      if (rpcError) {
        summary.errors.push(`${today}: ${rpcError.message}`)
        continue
      }
      summary.created += Number(data) || 0
    }

    const ok = summary.errors.length === 0
    await recordCronRun('auto-expenses', ok, Date.now() - startedAt, summary)
    return jsonOk({ ok, ...summary })
  } catch (err) {
    summary.errors.push((err as Error).message)
    await recordCronRun('auto-expenses', false, Date.now() - startedAt, summary)
    return jsonOk({ ok: false, ...summary })
  }
}

export const POST = withErrorHandler(handlePOST)
