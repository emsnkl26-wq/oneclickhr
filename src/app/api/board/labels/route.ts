import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { taskLabelSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const createSchema = taskLabelSchema.extend({ boardId: z.string().uuid() })

/**
 * Define a label.
 *
 * The label VOCABULARY belongs to the org — anyone able to invent a label makes
 * the picker a junk drawer within a month — while APPLYING one is open to
 * whoever is working the card (`task_label_links_insert`).
 *
 * Names are unique per board, case-insensitively, by index. "Urgent" and
 * "urgent" on one board are the same label, and a picker showing both is a
 * picker nobody trusts.
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

  const { data, error } = await supabase
    .from('task_labels')
    .insert({
      tenant_id: ctx.tenantId,
      board_id: input.boardId,
      name: input.name,
      color: input.color,
    })
    .select('id, name, color')
    .single()

  if (error) {
    // The generic "that already exists" is true but unhelpful when there is
    // exactly one thing it can mean here.
    if (error.code === '23505') return jsonError('That label already exists on this board.', 409)
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task_label.created',
    entity: 'task_labels',
    entityId: data.id,
    meta: { name: data.name },
    request,
  })

  return jsonOk(data, 201)
}

export const POST = withErrorHandler(handlePOST)
