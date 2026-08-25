import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { experienceSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/** A profile section is capped so the page stays a profile, not a CV archive. */
const MAX_ENTRIES = 20

/**
 * Add a role to the caller's work history.
 *
 * `employee_id` is taken from the SESSION and never from the body. The RLS
 * `WITH CHECK` says the same thing (`employee_id = auth.uid()` for a non-org
 * caller), so an id smuggled into the payload would be refused by the database
 * as well — but not accepting it at all means there is nothing to smuggle.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, experienceSchema)
  const supabase = await createSupabaseServerClient()

  const { count } = await supabase
    .from('employee_experience')
    .select('id', { count: 'exact', head: true })
    .eq('employee_id', ctx.userId)

  if ((count ?? 0) >= MAX_ENTRIES) {
    return jsonError(`You can list up to ${MAX_ENTRIES} roles.`, 409)
  }

  const { data, error } = await supabase
    .from('employee_experience')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: ctx.userId,
      company_name: input.companyName,
      role_title: input.roleTitle,
      start_date: input.startDate ?? null,
      // "Current" and an end date are contradictory; the flag wins.
      end_date: input.isCurrent ? null : (input.endDate ?? null),
      is_current: input.isCurrent,
      summary: input.summary,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'profile.experience_added',
    entity: 'employee_experience',
    entityId: data.id,
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
