import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { taskLabelSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, taskLabelSchema.partial())
  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.color !== undefined) patch.color = input.color
  if (!Object.keys(patch).length) return jsonError('Nothing to change.', 400)

  const { data, error } = await supabase
    .from('task_labels')
    .update(patch)
    .eq('id', id)
    .select('id, name, color')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') return jsonError('That label already exists on this board.', 409)
    return jsonError(friendlyDbError(error), 400)
  }
  if (!data) return jsonError('That label was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task_label.updated',
    entity: 'task_labels',
    entityId: id,
    meta: { name: data.name },
    request,
  })

  return jsonOk(data)
}

/**
 * Delete a label.
 *
 * Unlike a column, this needs no "move the contents first" guard: the links
 * cascade and the TASKS are untouched. Losing a classification is recoverable
 * by re-labelling; losing the cards would not be.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('task_labels')
    .delete()
    .eq('id', id)
    .select('id, name')

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data?.length) return jsonError('That label was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task_label.deleted',
    entity: 'task_labels',
    entityId: id,
    meta: { name: data[0].name },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
