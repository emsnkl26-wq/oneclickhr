import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { reviewTimesheetSchema } from '@/lib/schemas'
import { notifyEmployee } from '@/lib/notify'
import { formatPeriod } from '@/lib/time'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Approve or reject a submitted week.
 *
 * `.eq('status', 'submitted')` on the UPDATE is what makes the decision
 * idempotent: a double-click, or two admins opening the same queue, cannot flip
 * a sheet that has already been decided — the second write matches no row and is
 * reported as a conflict rather than silently overwriting the first decision.
 *
 * Approval is also what makes the hours count. `project_hour_totals()` sums only
 * entries belonging to approved sheets, so there is no counter to increment
 * here and nothing to repair if a week is later rejected and resubmitted.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, reviewTimesheetSchema)
  const supabase = await createSupabaseServerClient()

  const { data: sheet } = await supabase
    .from('timesheets')
    .select('id, code, employee_id, week_start, week_end, status, total_hours')
    .eq('id', id)
    .maybeSingle()

  if (!sheet) return jsonError('That timesheet was not found.', 404)
  if (sheet.status !== 'submitted') {
    return jsonError('That timesheet has already been decided.', 409)
  }

  const { data: updated, error } = await supabase
    .from('timesheets')
    .update({
      status: input.status,
      review_note: input.note,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'submitted')
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!updated) return jsonError('That timesheet has already been decided.', 409)

  const period = formatPeriod(sheet.week_start, sheet.week_end)
  await notifyEmployee(supabase, {
    tenantId: ctx.tenantId,
    employeeId: sheet.employee_id,
    createdBy: ctx.userId,
    title:
      input.status === 'approved'
        ? `Timesheet ${sheet.code} approved`
        : `Timesheet ${sheet.code} needs changes`,
    description:
      input.status === 'approved'
        ? `Your timesheet for ${period} (${Number(sheet.total_hours)} hours) has been approved.`
        : `Your timesheet for ${period} was returned. ${input.note ?? ''}`.trim(),
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `timesheet.${input.status}`,
    entity: 'timesheets',
    entityId: id,
    meta: { code: sheet.code, employeeId: sheet.employee_id, hours: Number(sheet.total_hours) },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
