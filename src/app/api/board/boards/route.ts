import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { boardSchema, syncBoardMembers, seedBoardColumns } from '../board-writes'

export const dynamic = 'force-dynamic'

const createSchema = boardSchema.extend({
  memberIds: z.array(z.string().uuid()).max(500).default([]),
})

/**
 * Create a board.
 *
 * Org only (`boards_write`). The new board opens with the SAME stages as the
 * tenant's existing board — see `seedBoardColumns` — so a second board looks
 * and behaves exactly like the first.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, createSchema)
  const supabase = await createSupabaseServerClient()

  const { data: board, error } = await supabase
    .from('boards')
    .insert({
      tenant_id: ctx.tenantId,
      name: input.name,
      description: input.description || null,
      color: input.color,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  const seeded = await seedBoardColumns(supabase, { boardId: board.id, tenantId: ctx.tenantId })
  if (!seeded) {
    // A board with no stages cannot hold a card. Undo rather than leave one.
    await supabase.from('boards').delete().eq('id', board.id)
    return jsonError('The board could not be set up. Please try again.', 500)
  }

  const members = await syncBoardMembers(supabase, {
    boardId: board.id,
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    desired: input.memberIds,
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'board.created',
    entity: 'boards',
    entityId: board.id,
    meta: { name: input.name, members: members.added.length },
    request,
  })

  // The board exists either way; a refused roster is reported, not dropped.
  return jsonOk({ id: board.id, memberError: members.error }, 201)
}

export const POST = withErrorHandler(handlePOST)
