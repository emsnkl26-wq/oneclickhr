import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { assignmentSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Place an employee with a vendor, at a bill rate and a pay rate.
 *
 * ORG-ONLY. This route is where `bill_rate` enters the system, and
 * `apiRequireOrg()` plus the org-only RLS policy on `employee_assignments` are
 * the two things keeping it away from employees. See the header of 022.
 *
 * `is_primary` is enforced by a partial unique index rather than by clearing
 * the old one here — a check-then-write would let two concurrent saves both
 * believe they were first. The 23505 is translated below, and the client is
 * expected to clear the previous primary explicitly if that is what it meant.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, assignmentSchema)
  const supabase = await createSupabaseServerClient()

  /*
   * The employee has to be one of ours. RLS would refuse the write anyway, but
   * an explicit check produces "that employee was not found" instead of a bare
   * policy violation — and it keeps the failure at the top of the handler where
   * somebody reading this can see the rule.
   */
  const { data: employee } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', input.employeeId)
    .eq('role', 'employee')
    .maybeSingle()

  if (!employee) return jsonError('That employee was not found.', 404)

  const { data, error } = await supabase
    .from('employee_assignments')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: input.employeeId,
      vendor_id: input.vendorId,
      client_id: input.clientId ?? null,
      project_id: input.projectId ?? null,
      bill_rate: input.billRate,
      bill_currency: input.billCurrency,
      pay_rate: input.payRate,
      pay_currency: input.payCurrency,
      rate_unit: input.rateUnit,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      is_primary: input.isPrimary,
      status: input.status,
      notes: input.notes,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return jsonError(
        'This employee already has a primary placement. Clear that one first, or add this as a secondary placement.',
        409
      )
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'placement.created',
    entity: 'employee_assignments',
    entityId: data.id,
    // The rates are deliberately NOT in the audit meta. Audit rows are read by
    // a wider audience than the placement itself, and there is no question this
    // log answers that needs the bill rate spelled out in it.
    meta: { employeeId: input.employeeId, vendorId: input.vendorId },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
