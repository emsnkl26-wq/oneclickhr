import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { skillsSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Replace the caller's skill tags.
 *
 * A separate route from `/api/employee/profile` rather than another field on it,
 * because the tag editor saves on every add and remove while the profile form
 * saves on submit — sharing one endpoint would mean each of them posting the
 * other's state and occasionally reverting it.
 *
 * The write lands on `profiles.skills`, which `tg_profiles_guard` does not list
 * among the privileged columns, so a self-update is permitted. Everything the
 * guard does protect is untouched here.
 */
async function handlePUT(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, skillsSchema)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('profiles')
    .update({ skills: input.skills })
    .eq('id', ctx.userId)

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'profile.skills_updated',
    entity: 'profiles',
    entityId: ctx.userId,
    meta: { count: input.skills.length },
    request,
  })

  return jsonOk({ skills: input.skills })
}

export const PUT = withErrorHandler(handlePUT)
