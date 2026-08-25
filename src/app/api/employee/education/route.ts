import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { educationSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const MAX_ENTRIES = 20

/** Add a qualification. `employee_id` comes from the session, never the body. */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, educationSchema)
  const supabase = await createSupabaseServerClient()

  const { count } = await supabase
    .from('employee_education')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', ctx.userId)

  if ((count ?? 0) >= MAX_ENTRIES) {
    return jsonError(`You can list up to ${MAX_ENTRIES} qualifications.`, 409)
  }

  const { data, error } = await supabase
    .from('employee_education')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: ctx.userId,
      institution: input.institution,
      degree: input.degree,
      field_of_study: input.fieldOfStudy,
      completion_year: input.completionYear ?? null,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'profile.education_added',
    entity: 'employee_education',
    entityId: data.id,
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
