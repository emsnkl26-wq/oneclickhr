import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { editAttendanceSchema } from '@/lib/schemas'
import { fromZonedInput, localDate, hoursBetween, isLateLogin } from '@/lib/time'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Longer than any real shift; a longer span is a typo, not overtime. */
const MAX_SHIFT_HOURS = 24

/**
 * Correct a shift's clock-in and clock-out.
 *
 * The case this exists for: somebody forgets to clock out, and the shift sits
 * open — or is closed the next morning — claiming twenty-odd hours. The org sets
 * the real times; `total_hours` and `is_late` are recomputed here from them
 * rather than accepted from the form, so the stored figures always follow from
 * the stored instants.
 *
 * Times arrive as wall-clock in the WORKSPACE's zone, the same zone the grid
 * shows them in, and the clock-in must stay on the day the row is filed under —
 * moving it to another day would silently collide with that day's row.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, editAttendanceSchema)
  const tz = ctx.tenant.timezone
  const supabase = await createSupabaseServerClient()

  const { data: record } = await supabase
    .from('attendance')
    .select('id, employee_id, date, login_time, logout_time, total_hours')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!record) return jsonError('That attendance record was not found.', 404)

  const login = fromZonedInput(input.loginTime, tz)
  const logout = input.logoutTime ? fromZonedInput(input.logoutTime, tz) : null
  if (!login || (input.logoutTime && !logout)) return jsonError('Those times are not valid.', 400)

  const now = Date.now()
  if (localDate(login, tz) !== record.date) {
    return jsonError(`Clock-in must stay on ${record.date}.`, 400)
  }
  if (new Date(login).getTime() > now || (logout && new Date(logout).getTime() > now)) {
    return jsonError('Times cannot be in the future.', 400)
  }
  if (logout) {
    const span = hoursBetween(login, logout)
    if (new Date(logout).getTime() <= new Date(login).getTime()) {
      return jsonError('Clock-out must be after clock-in.', 400)
    }
    if (span > MAX_SHIFT_HOURS) {
      return jsonError(`A shift cannot be longer than ${MAX_SHIFT_HOURS} hours.`, 400)
    }
  }

  const { data: updated, error } = await supabase
    .from('attendance')
    .update({
      login_time: login,
      logout_time: logout,
      total_hours: logout ? hoursBetween(login, logout) : null,
      is_late: isLateLogin(login, ctx.tenant.workStartTime, tz),
      edited_by: ctx.userId,
      edited_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('id, login_time, logout_time, total_hours, is_late')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!updated) return jsonError('That attendance record was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'attendance.corrected',
    entity: 'attendance',
    entityId: id,
    meta: {
      employeeId: record.employee_id,
      date: record.date,
      before: {
        login: record.login_time,
        logout: record.logout_time,
        hours: record.total_hours == null ? null : Number(record.total_hours),
      },
      after: { login, logout, hours: updated.total_hours == null ? null : Number(updated.total_hours) },
      reason: input.reason,
    },
    request,
  })

  return jsonOk({ record: updated })
}

export const PATCH = withErrorHandler(handlePATCH)
