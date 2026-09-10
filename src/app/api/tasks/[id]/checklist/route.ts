import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { checklistItemSchema } from '@/lib/schemas'
import { nextPositionInColumn } from '@/lib/task-writes'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Add a step to a card's checklist.
 *
 * Who may: the org, the card's assignees, or whoever raised it —
 * `task_checklist_write`. Not re-checked here; a refusal arrives as a 42501,
 * which `friendlyDbError` turns into a permission message.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const taskId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, checklistItemSchema)
  const supabase = await createSupabaseServerClient()

  const { data: task } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle()
  if (!task) return jsonError('That task was not found.', 404)

  const position = await nextPositionInColumn(supabase, 'task_checklist_items', {
    column: 'task_id',
    value: taskId,
  })

  const { data, error } = await supabase
    .from('task_checklist_items')
    .insert({
      tenant_id: ctx.tenantId,
      task_id: taskId,
      content: input.content,
      position,
    })
    .select('id, content, is_done, position, done_at')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('You cannot change this task’s checklist.', 403)

  return jsonOk({ ...data, position: Number(data.position) }, 201)
}

export const POST = withErrorHandler(handlePOST)
