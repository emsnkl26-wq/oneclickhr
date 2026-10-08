import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Remove a progress note (059).
 *
 * `project_updates_delete` allows the AUTHOR's own note, or anything inside the
 * workspace for an org admin. There is no `.eq('author_id', …)` here on purpose:
 * writing one would re-state half the policy and get the org admin's case
 * wrong. The delete is reported as a miss when no row came back, which covers
 * both "already gone" and "not yours" without saying which.
 */
async function handleDELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const { id } = await context.params
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('project_updates')
    .delete()
    .eq('id', id)
    .select('id, project_id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That update could not be found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'project.update.deleted',
    entity: 'project_updates',
    entityId: id,
    meta: { projectId: (data as { project_id: string }).project_id },
    request,
  })

  return jsonOk({ ok: true })
}

export const DELETE = withErrorHandler(handleDELETE)
