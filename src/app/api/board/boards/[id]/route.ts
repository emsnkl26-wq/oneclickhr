import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { audit } from '@/lib/audit'
import { boardSchema, syncBoardMembers } from '../../board-writes'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const updateSchema = boardSchema.partial().extend({
  memberIds: z.array(z.string().uuid()).max(500).optional(),
})

/**
 * Rename, recolour or re-describe a board, and/or set its roster.
 *
 * Org only. No row back means the board is not in the caller's tenant.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, updateSchema)
  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.description !== undefined) patch.description = input.description || null
  if (input.color !== undefined) patch.color = input.color

  const { data, error } = Object.keys(patch).length
    ? await supabase.from('boards').update(patch).eq('id', id).select('id').maybeSingle()
    : await supabase.from('boards').select('id').eq('id', id).maybeSingle()
  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That board was not found.', 404)

  if (input.memberIds !== undefined) {
    const members = await syncBoardMembers(supabase, {
      boardId: id,
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      desired: input.memberIds,
    })
    if (members.error) return jsonError(members.error, 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'board.updated',
    entity: 'boards',
    entityId: id,
    meta: { fields: Object.keys(patch), members: input.memberIds !== undefined },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete a board. Its stages, cards, comments and history cascade with it, so
 * the UI asks for the board's name to be typed first.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.from('boards').delete().eq('id', id).select('id, name')
  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data?.length) return jsonError('That board was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'board.deleted',
    entity: 'boards',
    entityId: id,
    meta: { name: data[0].name },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
