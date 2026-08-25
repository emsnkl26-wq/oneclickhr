import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { projectSchema } from '@/lib/schemas'
import { resolveProjectMembers } from '@/lib/projects'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Create a project and assign its team in one request.
 *
 * The PRJ- code is NOT accepted from the client: `tg_projects_code` mints it
 * from a per-tenant counter, so two admins clicking Create at the same instant
 * cannot be handed PRJ-004 twice, and tenant B's first project is PRJ-001 no
 * matter how many tenant A has.
 *
 * Assignments are inserted after the project row rather than in a single
 * statement, so the ids in `employeeIds` are re-proved to belong to this tenant
 * first. Under RLS a foreign id resolves to nothing — the filter below is what
 * turns that into an explicit refusal instead of a silently short team.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, projectSchema)
  const supabase = await createSupabaseServerClient()

  const memberIds = await resolveProjectMembers(supabase, input.employeeIds)
  if (memberIds === null) {
    return jsonError('One of those people is not in this workspace.', 400)
  }

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      tenant_id: ctx.tenantId,
      name: input.name,
      client_name: input.clientName,
      end_client_name: input.endClientName,
      description: input.description,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      status: input.status,
      created_by: ctx.userId,
    })
    .select('id, code')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  if (memberIds.length) {
    const { error: assignError } = await supabase.from('project_assignments').insert(
      memberIds.map((employeeId) => ({
        project_id: project.id,
        employee_id: employeeId,
        tenant_id: ctx.tenantId,
      }))
    )
    // The project exists and is usable; a failed assignment is reported rather
    // than rolled back, and the org can fix the team from the project page.
    if (assignError) {
      console.error('[projects] assignment insert failed', assignError.message)
    }
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'project.created',
    entity: 'projects',
    entityId: project.id,
    meta: { code: project.code, members: memberIds.length },
    request,
  })

  return jsonOk({ id: project.id, code: project.code }, 201)
}

export const POST = withErrorHandler(handlePOST)
