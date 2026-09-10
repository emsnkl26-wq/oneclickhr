import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { updateChecklistItemSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; itemId: string }> }

/**
 * Tick, rename or reorder one step.
 *
 * `done_at` and `done_by` are NOT settable from here — the table's trigger
 * derives them from `is_done`, so the two cannot drift apart no matter what a
 * client sends.
 *
 * The `task_id` equality is not redundant with the id: without it, an item id
 * from a different card in the same tenant would be writable through this URL,
 * and the caller's permission would be evaluated against the WRONG card.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const { id: taskId, itemId } = await params
  uuidSchema.parse(taskId)
  const id = uuidSchema.parse(itemId)

  const input = await parseBody(request, updateChecklistItemSchema)
  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = {}
  if (input.content !== undefined) patch.content = input.content
  if (input.isDone !== undefined) patch.is_done = input.isDone
  if (input.position !== undefined) patch.position = input.position

  const { data, error } = await supabase
    .from('task_checklist_items')
    .update(patch)
    .eq('id', id)
    .eq('task_id', taskId)
    .select('id, content, is_done, position, done_at')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('You cannot change this task’s checklist.', 403)

  return jsonOk({ ...data, position: Number(data.position) })
}

async function handleDELETE(_request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const { id: taskId, itemId } = await params
  uuidSchema.parse(taskId)
  const id = uuidSchema.parse(itemId)

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('task_checklist_items')
    .delete()
    .eq('id', id)
    .eq('task_id', taskId)
    .select('id')

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data?.length) return jsonError('You cannot change this task’s checklist.', 403)

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
