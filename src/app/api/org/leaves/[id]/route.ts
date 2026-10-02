import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { decideLeaveSchema } from '@/lib/schemas'
import { sendLeaveDecision, isEmailConfigured } from '@/lib/email'
import { notifyEmployee } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Approve or reject a leave request.
 *
 * Only the org can reach this: the `leaves_update` policy grants UPDATE to org
 * users alone, so there is no code path — here or anywhere — by which an
 * employee approves their own leave. The `.eq('status', 'pending')` filter makes
 * the decision idempotent; a double-click cannot flip an already-decided request.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, decideLeaveSchema)

  const supabase = await createSupabaseServerClient()

  const { data: leave } = await supabase
    .from('leaves')
    .select('id, employee_id, start_date, end_date, status')
    .eq('id', id)
    .maybeSingle()

  if (!leave) return jsonError('That leave request was not found.', 404)
  if (leave.status !== 'pending') {
    return jsonError('That request has already been decided.', 409)
  }

  const { data: updated, error } = await supabase
    .from('leaves')
    .update({
      status: input.status,
      approver_id: ctx.userId,
      decision_note: input.note,
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!updated) return jsonError('That request has already been decided.', 409)

  // Tell the employee. Never fatal — the decision is recorded either way.
  await notifyEmployee(supabase, {
    tenantId: ctx.tenantId,
    employeeId: leave.employee_id,
    createdBy: ctx.userId,
    event: 'leave.decided',
    subjectId: id,
    title: `Your leave request was ${input.status}`,
    description: `${leave.start_date} → ${leave.end_date}${input.note ? ` · ${input.note}` : ''}`,
  })

  if (isEmailConfigured()) {
    const { data: employee } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', leave.employee_id)
      .maybeSingle()

    if (employee?.email) {
      await sendLeaveDecision({
        to: employee.email,
        employeeName: employee.full_name ?? '',
        status: input.status,
        startDate: leave.start_date,
        endDate: leave.end_date,
        note: input.note,
        orgName: ctx.tenant.name,
        brandColor: ctx.tenant.primaryColor,
      })
    }
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `leave.${input.status}`,
    entity: 'leaves',
    entityId: id,
    meta: { employeeId: leave.employee_id },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
