import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { boardColumnSchema, moveColumnSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'
import { clearOtherBacklogs } from '@/lib/task-writes'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Rename or reconfigure a column — or, with only `position`, reorder it.
 *
 * The two arrive at the same endpoint because they are the same row and the
 * same permission. `.partial()` on the settings schema is what lets a drag send
 * `{ position }` alone without also having to restate the column's name.
 */
const patchSchema = boardColumnSchema.partial().merge(moveColumnSchema.partial())

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, patchSchema)
  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.color !== undefined) patch.color = input.color
  if (input.wipLimit !== undefined) patch.wip_limit = input.wipLimit
  if (input.appliesStatus !== undefined) patch.applies_status = input.appliesStatus
  if (input.isBacklog !== undefined) patch.is_backlog = input.isBacklog
  if (input.position !== undefined) patch.position = input.position

  if (!Object.keys(patch).length) return jsonError('Nothing to change.', 400)

  const { data, error } = await supabase
    .from('board_columns')
    .update(patch)
    .eq('id', id)
    .select('id, board_id, name, position, color, wip_limit, applies_status, is_backlog')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That column was not found.', 404)

  if (input.isBacklog) await clearOtherBacklogs(supabase, data.board_id, data.id)

  // A reorder happens on every drag and says nothing anyone will later want to
  // read; a rename or a stage change is a decision about how the team works.
  const configChanged = Object.keys(patch).some((k) => k !== 'position')
  if (configChanged) {
    await audit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'board_column.updated',
      entity: 'board_columns',
      entityId: id,
      meta: { fields: Object.keys(patch) },
      request,
    })
  }

  return jsonOk({ ...data, position: Number(data.position) })
}

/**
 * Delete a column.
 *
 * Refused while it still holds tasks. `tasks.column_id` cascades on delete, so
 * removing a populated column would silently destroy the work in it — an
 * outcome nobody intends from a "remove column" click. Move the cards first, or
 * pass `?moveTo=<column>` to have them relocated as part of the same request.
 *
 * Archived cards count. They are hidden from the board, not gone, and deleting
 * the column they sit in would destroy them where their owner cannot see it
 * happening.
 */
const deleteQuery = z.object({ moveTo: z.string().uuid().optional() })

async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const { moveTo } = deleteQuery.parse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  )
  const supabase = await createSupabaseServerClient()

  const { data: column } = await supabase
    .from('board_columns')
    .select('id, board_id, name')
    .eq('id', id)
    .maybeSingle()
  if (!column) return jsonError('That column was not found.', 404)

  if (moveTo) {
    if (moveTo === id) return jsonError('Pick a different column to move the tasks to.', 400)

    const { data: target } = await supabase
      .from('board_columns')
      .select('id')
      .eq('id', moveTo)
      .eq('board_id', column.board_id)
      .maybeSingle()
    if (!target) return jsonError('That column was not found.', 404)

    const { error: moveError } = await supabase
      .from('tasks')
      .update({ column_id: moveTo })
      .eq('column_id', id)

    // Stop here rather than deleting: a partial move followed by a cascade is
    // how work disappears.
    if (moveError) return jsonError(friendlyDbError(moveError), 400)
  } else {
    const { count } = await supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('column_id', id)

    if (count && count > 0) {
      return jsonError(
        `Move the ${count} ${count === 1 ? 'task' : 'tasks'} out of this column before deleting it.`,
        409
      )
    }
  }

  const { error } = await supabase.from('board_columns').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'board_column.deleted',
    entity: 'board_columns',
    entityId: id,
    meta: { name: column.name, movedTo: moveTo ?? null },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
