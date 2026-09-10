import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { assignmentSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, assignmentSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('employee_assignments')
    .update({
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
    })
    .eq('id', id)
    .select('id, employee_id')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return jsonError(
        'This employee already has a primary placement. Clear that one first.',
        409
      )
    }
    return jsonError(friendlyDbError(error), 400)
  }
  if (!data) return jsonError('That placement was not found.', 404)

  /*
   * Changing a rate does NOT rewrite history.
   *
   * `timesheets.pay_amount` and `pay_rate_snapshot` are written once, at
   * approval, from the rate that applied then — and nothing here touches them.
   * An invoice already raised keeps its own line items too. A rate change
   * applies to what has not been decided yet, which is the only behaviour that
   * makes a rate change safe to perform.
   */
  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'placement.updated',
    entity: 'employee_assignments',
    entityId: id,
    meta: { employeeId: data.employee_id },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Remove a placement.
 *
 * Timesheets keep pointing at it (`timesheets_assignment_fk` is ON DELETE SET
 * NULL, so they simply lose the link) and keep their snapshotted pay figures.
 * Ending a placement is usually what is wanted instead — set `status` to
 * `ended`, which keeps the record and stops it being offered on new weeks.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('employee_assignments')
    .select('id, employee_id')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That placement was not found.', 404)

  const { error } = await supabase.from('employee_assignments').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'placement.deleted',
    entity: 'employee_assignments',
    entityId: id,
    meta: { employeeId: existing.employee_id },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
