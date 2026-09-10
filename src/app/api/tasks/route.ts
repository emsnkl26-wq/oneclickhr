import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { taskSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'
import {
  syncAssignees, syncLabels, notifyAssigned, nextPositionInColumn,
} from '@/lib/task-writes'

export const dynamic = 'force-dynamic'

/**
 * Create a task.
 *
 * ANY active member, not just the org — see the header of migration 030. The
 * rule that an employee's card is filed as themselves is the `tasks_insert`
 * policy's, not this handler's: `created_by` is set from the session below and
 * the policy refuses anything else, so there is one definition of it.
 *
 * The status is deliberately NOT defaulted here. Dropping a card into a column
 * that declares one ("Done") should make it that status, and the insert trigger
 * is where that happens — it also runs for every other writer.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, taskSchema)
  const supabase = await createSupabaseServerClient()

  // Board and column ids arrive from the client. RLS makes a foreign id resolve
  // to nothing, so this lookup doubles as the tenant check — and pairing the
  // two in one query is what stops a column from another board being used.
  const { data: column } = await supabase
    .from('board_columns')
    .select('id, board_id')
    .eq('id', input.columnId)
    .eq('board_id', input.boardId)
    .maybeSingle()

  if (!column) return jsonError('That column was not found.', 404)

  const position = await nextPositionInColumn(supabase, 'tasks', {
    column: 'column_id',
    value: input.columnId,
  })

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      tenant_id: ctx.tenantId,
      board_id: input.boardId,
      column_id: input.columnId,
      title: input.title,
      description: input.description,
      position,
      priority: input.priority,
      ...(input.status ? { status: input.status } : {}),
      due_date: input.dueDate ?? null,
      start_date: input.startDate ?? null,
      estimate_hours: input.estimateHours ?? null,
      created_by: ctx.userId,
    })
    .select('id, reference')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  const { added } = await syncAssignees(supabase, {
    taskId: task.id,
    tenantId: ctx.tenantId,
    desired: input.assigneeIds,
  })

  if (input.labelIds.length) {
    await syncLabels(supabase, {
      taskId: task.id,
      tenantId: ctx.tenantId,
      boardId: input.boardId,
      desired: input.labelIds,
    })
  }

  if (input.checklist.length) {
    // Spaced by 1000 so a later drag between two items has room to land
    // without renumbering the list.
    const { error: checklistError } = await supabase.from('task_checklist_items').insert(
      input.checklist.map((content, index) => ({
        tenant_id: ctx.tenantId,
        task_id: task.id,
        content,
        position: (index + 1) * 1000,
      }))
    )
    if (checklistError) console.error('[tasks] checklist failed', checklistError.message)
  }

  await notifyAssigned(supabase, {
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    profileIds: added,
    taskTitle: input.title,
    reference: task.reference,
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task.created',
    entity: 'tasks',
    entityId: task.id,
    meta: { assignees: added.length, reference: task.reference },
    request,
  })

  return jsonOk({ id: task.id, reference: task.reference }, 201)
}

export const POST = withErrorHandler(handlePOST)
