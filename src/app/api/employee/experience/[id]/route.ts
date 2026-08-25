import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { experienceSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Edit one role.
 *
 * No ownership branch here on purpose. The `employee_experience_write` policy
 * already answers "whose row is this?" — an employee matches only their own, an
 * org matches anything in its tenant — so a row that is not the caller's simply
 * does not exist for this query, and the 404 below IS the authorization.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, experienceSchema)
  const supabase = await createSupabaseServerClient()

  const { data: updated, error } = await supabase
    .from('employee_experience')
    .update({
      company_name: input.companyName,
      role_title: input.roleTitle,
      start_date: input.startDate ?? null,
      end_date: input.isCurrent ? null : (input.endDate ?? null),
      is_current: input.isCurrent,
      summary: input.summary,
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!updated) return jsonError('That entry was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'profile.experience_updated',
    entity: 'employee_experience',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: removed, error } = await supabase
    .from('employee_experience')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!removed) return jsonError('That entry was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'profile.experience_removed',
    entity: 'employee_experience',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
