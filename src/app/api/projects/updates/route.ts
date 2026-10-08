import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Post a progress note on a project (059).
 *
 * ONE ROUTE FOR BOTH SIDES, unlike most of this API, which splits `/api/org/`
 * from `/api/employee/`. The reason is that the authority here is not the
 * caller's ROLE but their relationship to one project: an org admin, an
 * assigned employee and the project's manager may all write a note, and each
 * of them writes exactly the same row. A split would have been two handlers
 * with one body between them.
 *
 * WHO MAY WRITE IS NOT DECIDED HERE. `project_updates_insert` pins `author_id`
 * to `auth.uid()` and requires org, membership or management of that project,
 * so the policy is the gate and this handler is only the friendly error in
 * front of it. `tenant_id` is taken from the SESSION, never the body.
 */
const schema = z.object({
  projectId: z.string().uuid(),
  body: z.string().trim().min(1, 'Write what moved.').max(4000),
  /**
   * Optional, and absent is NOT zero. A note without a percentage is the common
   * case; defaulting it would report every project as 0% done.
   */
  progress: z.coerce.number().int().min(0).max(100).nullish(),
})

async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, schema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('project_updates')
    .insert({
      tenant_id: ctx.tenantId,
      project_id: input.projectId,
      author_id: ctx.userId,
      body: input.body,
      progress: input.progress ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // A policy refusal arrives as a row-level-security violation, which reads
    // as a database error. Say what it actually means.
    if (error.code === '42501') {
      return jsonError('You can only post updates on a project you are on.', 403)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'project.update.created',
    entity: 'project_updates',
    entityId: (data as { id: string }).id,
    meta: { projectId: input.projectId, progress: input.progress ?? null },
    request,
  })

  return jsonOk({ id: (data as { id: string }).id }, 201)
}

export const POST = withErrorHandler(handlePOST)
