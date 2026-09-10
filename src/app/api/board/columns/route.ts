import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { boardColumnSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'
import { nextPositionInColumn, clearOtherBacklogs } from '@/lib/task-writes'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const createSchema = boardColumnSchema.extend({ boardId: z.string().uuid() })

/**
 * Add a stage to the board. Org only — how a workspace lays its work out is a
 * decision for the people who run it, and `board_columns_write` says so.
 *
 * A column may carry a status it applies on entry, a colour, a WIP limit, and
 * the "new tasks land here" flag. Only one column per board may be the backlog,
 * which is enforced by clearing the others below rather than by a partial unique
 * index: the flag moves, and an index would make moving it a two-statement dance
 * that can fail halfway.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, createSchema)
  const supabase = await createSupabaseServerClient()

  const { data: board } = await supabase
    .from('boards')
    .select('id')
    .eq('id', input.boardId)
    .maybeSingle()
  if (!board) return jsonError('That board was not found.', 404)

  const position = await nextPositionInColumn(supabase, 'board_columns', {
    column: 'board_id',
    value: input.boardId,
  })

  const { data, error } = await supabase
    .from('board_columns')
    .insert({
      tenant_id: ctx.tenantId,
      board_id: input.boardId,
      name: input.name,
      position,
      color: input.color ?? null,
      wip_limit: input.wipLimit ?? null,
      applies_status: input.appliesStatus ?? null,
      is_backlog: input.isBacklog ?? false,
    })
    .select('id, name, position, color, wip_limit, applies_status, is_backlog')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  if (input.isBacklog) await clearOtherBacklogs(supabase, input.boardId, data.id)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'board_column.created',
    entity: 'board_columns',
    entityId: data.id,
    meta: { name: data.name },
    request,
  })

  return jsonOk({ ...data, position: Number(data.position) }, 201)
}

export const POST = withErrorHandler(handlePOST)
