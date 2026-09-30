import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { orgEditTimesheetSchema, isBlankEntry } from '@/lib/schemas'
import { notifyEmployee } from '@/lib/notify'
import { formatPeriod } from '@/lib/time'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * The reviewer corrects the hours on a submitted week before deciding on it.
 *
 * ONLY WHILE SUBMITTED. Before that the week is still the employee's draft;
 * after approval its pay is snapshotted and it may already be on an invoice.
 * The status test below gives the friendly message; the 055 entry policies
 * refuse the write on their own if the week is decided between the two.
 *
 * The lines are replaced through the same `save_timesheet_entries()` the
 * employee uses, so the totals and overtime are recomputed by the database
 * exactly as they would be for an employee's own save — nothing here computes
 * an hour figure that could disagree with the grid.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, orgEditTimesheetSchema)
  const supabase = await createSupabaseServerClient()

  const { data: sheet } = await supabase
    .from('timesheets')
    .select('id, code, employee_id, status, week_start, week_end, total_hours')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!sheet) return jsonError('That timesheet was not found.', 404)
  if (sheet.status !== 'submitted') {
    return jsonError('Only a timesheet awaiting review can be edited.', 409)
  }

  const entries = input.entries.filter((entry) => !isBlankEntry(entry))
  if (entries.length === 0) return jsonError('A timesheet needs at least one line.', 400)

  /*
   * Hours may only be moved onto projects the EMPLOYEE is on — the same rule
   * their own save follows, so a correction cannot bill a client for work on a
   * project the person was never staffed on. Projects already on the week are
   * allowed as they stand, in case the assignment ended after submission.
   */
  const projectIds = Array.from(
    new Set(entries.map((entry) => entry.projectId).filter(Boolean) as string[])
  )
  if (projectIds.length) {
    const [{ data: assigned }, { data: existing }] = await Promise.all([
      supabase
        .from('project_assignments')
        .select('project_id')
        .eq('employee_id', sheet.employee_id)
        .in('project_id', projectIds),
      supabase
        .from('timesheet_entries')
        .select('project_id')
        .eq('timesheet_id', id)
        .in('project_id', projectIds),
    ])

    const allowed = new Set([
      ...(assigned ?? []).map((row) => row.project_id),
      ...(existing ?? []).map((row) => row.project_id),
    ])
    if (projectIds.some((projectId) => !allowed.has(projectId))) {
      return jsonError('The employee is not assigned to one of those projects.', 403)
    }
  }

  const { error: saveError } = await supabase.rpc('save_timesheet_entries', {
    p_timesheet_id: id,
    p_entries: entries,
  })
  if (saveError) return jsonError(friendlyDbError(saveError), 400)

  const { data: updated } = await supabase
    .from('timesheets')
    .select('total_hours, billable_hours, overtime_hours')
    .eq('id', id)
    .maybeSingle()

  const before = Number(sheet.total_hours)
  const after = Number(updated?.total_hours ?? 0)

  await notifyEmployee(supabase, {
    tenantId: ctx.tenantId,
    employeeId: sheet.employee_id,
    createdBy: ctx.userId,
    event: 'timesheet.decided',
    subjectId: id,
    title: `Timesheet ${sheet.code} was adjusted`,
    description: `Your reviewer changed the hours for ${formatPeriod(sheet.week_start, sheet.week_end)} from ${before} to ${after}. Reason: ${input.reason}`,
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'timesheet.adjusted',
    entity: 'timesheets',
    entityId: id,
    meta: {
      code: sheet.code,
      employeeId: sheet.employee_id,
      hoursBefore: before,
      hoursAfter: after,
      lines: entries.length,
      reason: input.reason,
    },
    request,
  })

  return jsonOk({
    ok: true,
    totalHours: after,
    billableHours: Number(updated?.billable_hours ?? 0),
    overtimeHours: Number(updated?.overtime_hours ?? 0),
  })
}

export const PATCH = withErrorHandler(handlePATCH)
