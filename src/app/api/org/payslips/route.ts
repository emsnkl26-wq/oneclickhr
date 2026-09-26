import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { payslipSchema } from '@/lib/schemas'
import { keyBelongsToTenant, deleteObject } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Attach an uploaded payslip PDF to an employee for a given month.
 *
 * The file has already passed the upload pipeline (which enforces that a
 * payslip is genuinely a PDF, by magic bytes rather than by extension). This
 * route only binds it to a person and a period.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, payslipSchema)

  if (!keyBelongsToTenant(input.key, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  // The employee id came from the request, so confirm it resolves inside this
  // tenant. Under RLS a foreign id returns nothing, which is the check.
  const { data: employee } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', input.employeeId)
    .eq('role', 'employee')
    .maybeSingle()

  if (!employee) return jsonError('That employee was not found.', 404)

  // One payslip per person per month: regenerating a month REPLACES its slip,
  // so the employee only ever sees the current version.
  const { data: previous } = await supabase
    .from('payslips')
    .select('id, file_url')
    .eq('employee_id', input.employeeId)
    .eq('year', input.year)
    .eq('month', input.month)
    .maybeSingle()

  if (previous) {
    const { error: updateError } = await supabase
      .from('payslips')
      .update({ file_url: input.key, file_name: input.fileName, uploaded_by: ctx.userId })
      .eq('id', previous.id)
    if (updateError) {
      await deleteObject(input.key)
      return jsonError(friendlyDbError(updateError), 400)
    }
    if (previous.file_url && previous.file_url !== input.key) await deleteObject(previous.file_url)

    await audit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'payslip.replaced',
      entity: 'payslips',
      entityId: previous.id,
      meta: { employeeId: input.employeeId, month: input.month, year: input.year },
      request,
    })
    return jsonOk({ id: previous.id })
  }

  const { data, error } = await supabase
    .from('payslips')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: input.employeeId,
      month: input.month,
      year: input.year,
      file_url: input.key,
      file_name: input.fileName,
      uploaded_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) {
    // The unique index is per (tenant, employee, year, month) — one payslip per
    // person per period. Clean up the now-unreferenced object.
    await deleteObject(input.key)
    if (error.code === '23505') {
      return jsonError('That employee already has a payslip for this month.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'payslip.uploaded',
    entity: 'payslips',
    entityId: data.id,
    meta: { employeeId: input.employeeId, month: input.month, year: input.year },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
