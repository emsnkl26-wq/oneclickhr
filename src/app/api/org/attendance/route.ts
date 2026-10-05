import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { addAttendanceSchema } from '@/lib/schemas'
import { fromZonedInput, localDate, hoursBetween, isLateLogin, todayIn } from '@/lib/time'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** Longer than any real shift; a longer span is a typo, not overtime. */
const MAX_SHIFT_HOURS = 24

/**
 * File a shift for a day the employee never clocked.
 *
 * The companion to PATCH /api/org/attendance/[id]: that one corrects a shift
 * that exists, this one adds the shift somebody forgot to record at all. Only
 * today or earlier — attendance is a record of what happened, and a future day
 * has not. The same rules as a correction apply: times are wall-clock in the
 * workspace's zone, the clock-in must fall on the day it is filed under, and
 * `total_hours` / `is_late` are computed here, never accepted from the form.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, addAttendanceSchema)
  const tz = ctx.tenant.timezone
  const supabase = await createSupabaseServerClient()

  if (input.date > todayIn(tz)) return jsonError('You can only add attendance for today or earlier.', 400)

  const { data: employee } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', input.employeeId)
    .eq('tenant_id', ctx.tenantId)
    .eq('role', 'employee')
    .maybeSingle()
  if (!employee) return jsonError('That employee was not found.', 404)

  const login = fromZonedInput(input.loginTime, tz)
  const logout = input.logoutTime ? fromZonedInput(input.logoutTime, tz) : null
  if (!login || (input.logoutTime && !logout)) return jsonError('Those times are not valid.', 400)

  const now = Date.now()
  if (localDate(login, tz) !== input.date) {
    return jsonError(`Clock-in must be on ${input.date}.`, 400)
  }
  if (new Date(login).getTime() > now || (logout && new Date(logout).getTime() > now)) {
    return jsonError('Times cannot be in the future.', 400)
  }
  if (logout) {
    if (new Date(logout).getTime() <= new Date(login).getTime()) {
      return jsonError('Clock-out must be after clock-in.', 400)
    }
    if (hoursBetween(login, logout) > MAX_SHIFT_HOURS) {
      return jsonError(`A shift cannot be longer than ${MAX_SHIFT_HOURS} hours.`, 400)
    }
  }

  const { data: created, error } = await supabase
    .from('attendance')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: input.employeeId,
      date: input.date,
      login_time: login,
      logout_time: logout,
      total_hours: logout ? hoursBetween(login, logout) : null,
      is_late: isLateLogin(login, ctx.tenant.workStartTime, tz),
      edited_by: ctx.userId,
      edited_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    // The (tenant, employee, date) unique index: someone clocked in meanwhile.
    if (error.code === '23505') {
      return jsonError('A shift already exists for that day. Refresh and correct it instead.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'attendance.added',
    entity: 'attendance',
    entityId: created.id,
    meta: { employeeId: input.employeeId, date: input.date, login, logout, reason: input.reason },
    request,
  })

  return jsonOk({ id: created.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
