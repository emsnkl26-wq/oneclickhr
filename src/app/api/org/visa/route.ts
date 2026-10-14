import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { workAuthSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** Record an H-1B work authorization. The cron reminds on it from here on. */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, workAuthSchema)

  if (input.documentKey && !keyBelongsToTenant(input.documentKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  const { data: employee } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', input.employeeId)
    .eq('role', 'employee')
    // We stop tracking a leaver's work authorization along with everything else.
    .eq('is_active', true)
    .maybeSingle()
  if (!employee) return jsonError('That employee was not found.', 404)

  const { data, error } = await supabase
    .from('work_authorizations')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: input.employeeId,
      visa_type: input.visaType,
      visa_number: input.visaNumber,
      start_date: input.startDate ?? null,
      expiry_date: input.expiryDate,
      document_url: input.documentKey,
      notes: input.notes,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'work_auth.created',
    entity: 'work_authorizations',
    entityId: data.id,
    meta: { employeeId: input.employeeId, expiryDate: input.expiryDate },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
