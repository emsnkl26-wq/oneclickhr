import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createTimesheetSchema } from '@/lib/schemas'
import { weekStartSunday, addDays, todayIn } from '@/lib/time'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** How far ahead a week may be opened. Beyond this it is a typo, not a plan. */
const MAX_WEEKS_AHEAD = 2

/**
 * Open a timesheet for a week.
 *
 * The posted date is NORMALISED to that week's Sunday rather than trusted:
 * `timesheets_week_unique` is on (tenant, employee, week_start), so accepting a
 * Wednesday would let the same week be opened seven times over — one row per day
 * someone happened to click on — and each would look like a separate period.
 *
 * The row is created empty. The grid's lines arrive on the first save, which is
 * also what lets an employee open a week now and fill it in on Friday.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, createTimesheetSchema)
  const weekStart = weekStartSunday(input.weekStart)
  const weekEnd = addDays(weekStart, 6)

  // Compared in the ORG's timezone — which week is "this" one is a local idea.
  const horizon = addDays(weekStartSunday(todayIn(ctx.tenant.timezone)), MAX_WEEKS_AHEAD * 7)
  if (weekStart > horizon) {
    return jsonError('That week is too far ahead to open yet.', 400)
  }

  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('timesheets')
    .select('id, code')
    .eq('employee_id', ctx.userId)
    .eq('week_start', weekStart)
    .maybeSingle()

  if (existing) {
    return jsonError('You already have a timesheet for that week.', 409)
  }

  const { data, error } = await supabase
    .from('timesheets')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: ctx.userId,
      week_start: weekStart,
      week_end: weekEnd,
      status: 'open',
    })
    .select('id, code')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'timesheet.created',
    entity: 'timesheets',
    entityId: data.id,
    meta: { code: data.code, weekStart },
    request,
  })

  return jsonOk({ id: data.id, code: data.code, weekStart, weekEnd }, 201)
}

export const POST = withErrorHandler(handlePOST)
