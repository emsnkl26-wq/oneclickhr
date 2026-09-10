import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { clockActionSchema } from '@/lib/schemas'
import { todayIn, isLateLogin, hoursBetween } from '@/lib/time'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * The shift toggle: clock in, clock out.
 *
 * TIMEZONE IS THE WHOLE STORY HERE.
 *
 * `attendance.date` is a plain `date`, and a date only means something inside a
 * timezone. This function computes it in the ORG's zone (`tenants.timezone`,
 * default Asia/Kolkata) — never the server's. A Vercel lambda runs in UTC, so a
 * Mumbai nurse clocking in at 09:00 IST is at 03:30 UTC *the same day*, but one
 * clocking in at 02:00 IST is at 20:30 UTC the *previous* day. Take the server's
 * date and every late-evening and early-morning shift files itself under the
 * wrong day, and the weekly grid quietly disagrees with reality.
 *
 * The same applies to `is_late`: it compares wall-clock times in the org's zone
 * against the configured shift start, so it does not drift with DST either.
 *
 * The instants themselves (`login_time`, `logout_time`) stay `timestamptz` in
 * UTC. Only the DAY is local.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  /*
   * Not everybody punches a clock (025).
   *
   * Checked HERE, not only in the sidebar. Hiding the widget stops the button
   * being clicked; it does not stop a stale tab, a bookmark or a script, and an
   * attendance row for somebody on timesheets would quietly corrupt both the
   * attendance grid and their hours.
   *
   * A NULL MODE IS ALLOWED THROUGH. Nobody has said this person does not clock
   * in, and refusing on that basis is how the feature broke clocking in for
   * every employee in the product before any org had configured a thing. Only
   * an explicit, deliberate assignment closes this door.
   */
  if (ctx.trackingMode && ctx.trackingMode !== 'clock_in') {
    return jsonError(
      ctx.trackingMode === 'timesheet'
        ? 'You file a weekly timesheet rather than clocking in.'
        : 'Clocking in is not enabled for your account.',
      403
    )
  }

  // Stops a double-tap (or a stuck button) from racing itself.
  const limited = await rateLimit(limitKey('clock', ctx.userId), 20, 60 * 1000)
  if (!limited.ok) return jsonError('That was quick — please wait a moment.', 429)

  const { action } = await parseBody(request, clockActionSchema)

  const tz = ctx.tenant.timezone
  const today = todayIn(tz)
  const now = new Date()

  const supabase = await createSupabaseServerClient()

  // RLS confines this to the caller's own rows, so no employee can clock anyone
  // else in or out.
  const { data: existing } = await supabase
    .from('attendance')
    .select('id, login_time, logout_time')
    .eq('employee_id', ctx.userId)
    .eq('date', today)
    .maybeSingle()

  if (action === 'in') {
    if (existing && !existing.logout_time) {
      return jsonError('You are already clocked in.', 409)
    }
    if (existing?.logout_time) {
      return jsonError('You have already completed your shift for today.', 409)
    }

    const { data, error } = await supabase
      .from('attendance')
      .insert({
        tenant_id: ctx.tenantId,
        employee_id: ctx.userId,
        date: today,
        login_time: now.toISOString(),
        is_late: isLateLogin(now, ctx.tenant.workStartTime, tz),
      })
      .select('id, login_time, is_late')
      .single()

    if (error) {
      // The unique index on (tenant, employee, date) turns a genuine race into
      // a clean conflict rather than two rows for one day.
      if (error.code === '23505') return jsonError('You are already clocked in.', 409)
      return jsonError(friendlyDbError(error), 400)
    }

    await audit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'attendance.clock_in',
      entity: 'attendance',
      entityId: data.id,
      meta: { date: today, isLate: data.is_late },
      request,
    })

    return jsonOk({ clockedIn: true, loginTime: data.login_time, isLate: data.is_late })
  }

  // --- Clock out -----------------------------------------------------------
  if (!existing) return jsonError('You have not clocked in today.', 409)
  if (existing.logout_time) return jsonError('You have already clocked out.', 409)

  const totalHours = hoursBetween(existing.login_time, now)

  const { data, error } = await supabase
    .from('attendance')
    .update({ logout_time: now.toISOString(), total_hours: totalHours })
    .eq('id', existing.id)
    // Idempotent: a second request finds logout_time already set and matches
    // nothing, so the recorded hours cannot be overwritten by a late retry.
    .is('logout_time', null)
    .select('id, total_hours')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('You have already clocked out.', 409)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'attendance.clock_out',
    entity: 'attendance',
    entityId: data.id,
    meta: { date: today, totalHours },
    request,
  })

  return jsonOk({ clockedIn: false, totalHours: data.total_hours })
}

export const POST = withErrorHandler(handlePOST)
