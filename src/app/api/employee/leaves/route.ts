import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { applyLeaveSchema } from '@/lib/schemas'
import { inclusiveDays, todayIn } from '@/lib/time'
import { notifyOrgAdmins } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Apply for leave.
 *
 * `days` is computed here, not accepted from the form: it is inclusive of both
 * ends (a Monday-to-Monday request is one day, not zero), and it feeds whatever
 * the org counts against an allowance. The status is forced to `pending` both
 * here and in the RLS `WITH CHECK`, so there is no shape of request that files
 * itself pre-approved.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, applyLeaveSchema)

  // Compared in the ORG's timezone — "yesterday" is a local idea.
  if (input.startDate < todayIn(ctx.tenant.timezone)) {
    return jsonError('You cannot apply for leave that starts in the past.', 400)
  }

  const days = inclusiveDays(input.startDate, input.endDate)
  if (days > 365) return jsonError('That leave period is too long.', 400)

  const supabase = await createSupabaseServerClient()

  // Overlapping requests are the usual double-submit, and they make the org's
  // approval queue ambiguous.
  const { data: clash } = await supabase
    .from('leaves')
    .select('id')
    .eq('employee_id', ctx.userId)
    .neq('status', 'rejected')
    .lte('start_date', input.endDate)
    .gte('end_date', input.startDate)
    .limit(1)
    .maybeSingle()

  if (clash) {
    return jsonError('You already have a leave request covering those dates.', 409)
  }

  const { data, error } = await supabase
    .from('leaves')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: ctx.userId,
      start_date: input.startDate,
      end_date: input.endDate,
      days,
      reason: input.reason,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await notifyOrgAdmins(supabase, {
    tenantId: ctx.tenantId,
    createdBy: ctx.userId,
    event: 'leave.requested',
    subjectId: data.id,
    title: `${ctx.fullName || ctx.email} requested ${days} day${days === 1 ? '' : 's'} of leave`,
    description: `${input.startDate} → ${input.endDate}${input.reason ? ` · ${input.reason}` : ''}`,
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'leave.applied',
    entity: 'leaves',
    entityId: data.id,
    meta: { startDate: input.startDate, endDate: input.endDate, days },
    request,
  })

  return jsonOk({ id: data.id, days }, 201)
}

export const POST = withErrorHandler(handlePOST)
