import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { reviewTimesheetSchema } from '@/lib/schemas'
import { payForWeek } from '@/lib/billing'
import { notifyEmployee } from '@/lib/notify'
import { formatPeriod } from '@/lib/time'
import { audit } from '@/lib/audit'
import type { RateUnit } from '@/types/db'

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
    .select(
      'id, code, employee_id, week_start, week_end, status, total_hours, billable_hours, assignment_id'
    )
    .eq('id', id)
    .maybeSingle()

  if (!sheet) return jsonError('That timesheet was not found.', 404)
  if (sheet.status !== 'submitted') {
    return jsonError('That timesheet has already been decided.', 409)
  }

  const decision: Record<string, unknown> = {
    status: input.status,
    review_note: input.note,
    reviewed_by: ctx.userId,
    reviewed_at: new Date().toISOString(),
  }

  /*
   * Approval is when the employee's share is fixed.
   *
   * SNAPSHOTTED, not derived on read: a pay rate renegotiated in March must not
   * quietly rewrite what January's approved week said the person would earn.
   * The rate is read here — on an org-guarded route — and only the resulting
   * PAY figure is written to the timesheet, which the employee can read. The
   * bill rate is not touched and never lands on this row; see 023.
   *
   * A placement with no pay rate leaves the figure null rather than zero. "We
   * have not set your rate yet" and "you earned nothing" are different
   * statements and only one of them is true.
   */
  if (input.status === 'approved' && sheet.assignment_id) {
    const { data: assignment } = await supabase
      .from('employee_assignments')
      .select('pay_rate, pay_currency, rate_unit')
      .eq('id', sheet.assignment_id)
      .eq('tenant_id', ctx.tenantId)
      .maybeSingle()

    if (assignment) {
      const payRate = assignment.pay_rate == null ? null : Number(assignment.pay_rate)
      const amount = payForWeek(
        Number(sheet.billable_hours),
        payRate,
        assignment.rate_unit as RateUnit
      )
      decision.pay_rate_snapshot = payRate
      decision.pay_amount = amount
      decision.pay_currency = amount === null ? null : assignment.pay_currency
    }
  }

  const { data: updated, error } = await supabase
    .from('timesheets')
    .update(decision)
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
