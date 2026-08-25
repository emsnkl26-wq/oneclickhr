import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { educationSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Edit one qualification. The RLS policy is what scopes the row — see below. */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, educationSchema)
  const supabase = await createSupabaseServerClient()

  // `employee_education_write` matches an employee's own rows and an org's whole
  // tenant, so a row belonging to someone else does not exist for this update.
  const { data: updated, error } = await supabase
    .from('employee_education')
    .update({
      institution: input.institution,
      degree: input.degree,
      field_of_study: input.fieldOfStudy,
      completion_year: input.completionYear ?? null,
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
    action: 'profile.education_updated',
    entity: 'employee_education',
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
    .from('employee_education')
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
    action: 'profile.education_removed',
    entity: 'employee_education',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
