import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { projectSchema } from '@/lib/schemas'
import { resolveProjectMembers } from '@/lib/projects'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Edit a project, including its team.
 *
 * The assignment set is reconciled as a DIFFERENCE rather than deleted and
 * re-inserted. Wiping the table first would, for the split second between the
 * two statements, detach every member from the project — and an employee whose
 * timesheet page loaded in that window would be told they are on no projects at
 * all. Adding what is new and removing what is gone leaves the untouched rows
 * untouched.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, projectSchema)
  const supabase = await createSupabaseServerClient()

  // RLS scopes this to the tenant, so a foreign id is simply a 404.
  const { data: existing } = await supabase
    .from('projects')
    .select('id, code, status')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That project was not found.', 404)

  const memberIds = await resolveProjectMembers(supabase, input.employeeIds)
  if (memberIds === null) {
    return jsonError('One of those people is not in this workspace.', 400)
  }

  const { error } = await supabase
    .from('projects')
    .update({
      name: input.name,
      client_name: input.clientName,
      end_client_name: input.endClientName,
      description: input.description,
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      status: input.status,
    })
    .eq('id', id)

  if (error) return jsonError(friendlyDbError(error), 400)

  const { data: current } = await supabase
    .from('project_assignments')
    .select('employee_id')
    .eq('project_id', id)

  const before = new Set((current ?? []).map((row) => row.employee_id))
  const after = new Set(memberIds)

  const added = memberIds.filter((employeeId) => !before.has(employeeId))
  const removed = Array.from(before).filter((employeeId) => !after.has(employeeId))

  if (added.length) {
    await supabase.from('project_assignments').insert(
      added.map((employeeId) => ({
        project_id: id,
        employee_id: employeeId,
        tenant_id: ctx.tenantId,
      }))
    )
  }
  if (removed.length) {
    await supabase
      .from('project_assignments')
      .delete()
      .eq('project_id', id)
      .in('employee_id', removed)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'project.updated',
    entity: 'projects',
    entityId: id,
    meta: { code: existing.code, status: input.status, added: added.length, removed: removed.length },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete a project.
 *
 * Refused once hours have been logged against it: `timesheet_entries.project_id`
 * is ON DELETE SET NULL, so this would succeed and silently orphan every line
 * that named the project — including on weeks already approved and invoiced. An
 * org that wants it out of the way closes it instead, which is what the status
 * is for.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('projects')
    .select('id, code')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That project was not found.', 404)

  const { count } = await supabase
    .from('timesheet_entries')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', id)

  if (count && count > 0) {
    return jsonError(
      'Hours have been logged against this project, so it cannot be deleted. Mark it completed instead.',
      409
    )
  }

  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'project.deleted',
    entity: 'projects',
    entityId: id,
    meta: { code: existing.code },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
