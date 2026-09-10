import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { updateTaskSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'
import { loadTaskDetail } from '@/lib/task-detail'
import { syncAssignees, syncLabels, notifyAssigned } from '@/lib/task-writes'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** The thread, the checklist and the history — everything a card shows once open. */
async function handleGET(_request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const detail = await loadTaskDetail(supabase, id)
  if (!detail) return jsonError('That task was not found.', 404)

  return jsonOk(detail)
}

/**
 * Edit a task, move it, or both.
 *
 * ROLE RULE, ENFORCED ONCE: the org may change any card; an employee only cards
 * assigned to them or raised by them. This route does NOT re-implement that —
 * it lets the update return no rows and reads that as "not allowed", so the
 * `tasks_update` policy stays the single definition. The same applies to the
 * status/completion bookkeeping, which lives in the table's triggers.
 *
 * `position` is fractional. Dropping between two cards writes the average of
 * their positions, so ONE row changes instead of renumbering the column — which
 * matters both for latency and for how much Realtime traffic a drag produces.
 *
 * ABSENT IS NOT NULL. Every field is optional and only the keys actually
 * present are written, so a drag (which sends two fields) cannot clear a due
 * date the drag knew nothing about.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, updateTaskSchema)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('tasks')
    .select('id, board_id, column_id, title, reference')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That task was not found.', 404)

  // A move must stay on this task's own board. RLS already blocks another
  // tenant's column; this blocks another BOARD's column in the same tenant,
  // which would otherwise strand the card somewhere it is never rendered.
  if (input.columnId && input.columnId !== existing.column_id) {
    const { data: column } = await supabase
      .from('board_columns')
      .select('id')
      .eq('id', input.columnId)
      .eq('board_id', existing.board_id)
      .maybeSingle()
    if (!column) return jsonError('That column was not found.', 404)
  }

  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.priority !== undefined) patch.priority = input.priority
  if (input.status !== undefined) patch.status = input.status
  if (input.columnId !== undefined) patch.column_id = input.columnId
  if (input.position !== undefined) patch.position = input.position
  if (input.dueDate !== undefined) patch.due_date = input.dueDate
  if (input.startDate !== undefined) patch.start_date = input.startDate
  if (input.estimateHours !== undefined) patch.estimate_hours = input.estimateHours
  if (input.archived !== undefined) patch.archived_at = input.archived ? new Date().toISOString() : null

  let updated = existing

  if (Object.keys(patch).length) {
    const { data, error } = await supabase
      .from('tasks')
      .update(patch)
      .eq('id', id)
      .select('id, board_id, column_id, title, reference')
      .maybeSingle()

    if (error) return jsonError(friendlyDbError(error), 400)
    // No row came back: either it does not exist, or the policy refused. Both
    // are a 403 from the caller's point of view — distinguishing them would
    // leak whether a task id is real.
    if (!data) return jsonError('You can only change tasks assigned to you.', 403)
    updated = data
  }

  // The join tables have their own policies, so these run after the task write
  // rather than as part of it: a caller allowed to move a card but not to
  // reassign it gets the move, and the reassignment is simply refused.
  if (input.assigneeIds !== undefined) {
    const { added } = await syncAssignees(supabase, {
      taskId: id,
      tenantId: ctx.tenantId,
      desired: input.assigneeIds,
    })
    await notifyAssigned(supabase, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      profileIds: added,
      taskTitle: updated.title,
      reference: updated.reference,
    })
  }

  if (input.labelIds !== undefined) {
    await syncLabels(supabase, {
      taskId: id,
      tenantId: ctx.tenantId,
      boardId: existing.board_id,
      desired: input.labelIds,
    })
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    // A drag and an edit are different events to anyone reading the log later.
    action: input.columnId && Object.keys(patch).length <= 2 ? 'task.moved' : 'task.updated',
    entity: 'tasks',
    entityId: id,
    meta: { fields: Object.keys(patch) },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete a task.
 *
 * Open to any member, and narrowed by `tasks_delete`: an org may remove any
 * card, an employee only one they raised that nobody else has been assigned to.
 * Zero rows affected means the policy said no.
 *
 * Everything hanging off the card — comments, checklist, labels, watchers,
 * history — cascades. Archiving (PATCH `archived: true`) is the reversible
 * option and is what the UI offers first.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.from('tasks').delete().eq('id', id).select('id')
  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data?.length) {
    return jsonError('You can only delete tasks you raised that nobody else is working on.', 403)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task.deleted',
    entity: 'tasks',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

export const GET = withErrorHandler(handleGET)
export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
