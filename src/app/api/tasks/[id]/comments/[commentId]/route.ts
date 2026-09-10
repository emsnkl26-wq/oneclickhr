import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { updateCommentSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; commentId: string }> }

/**
 * Edit a comment.
 *
 * The author's alone — including for an org owner. An admin who can rewrite
 * what somebody else said turns the thread into something nobody can rely on
 * having read, so `task_comments_update` restricts this to `author_id =
 * auth.uid()` and this handler adds nothing to that: a refusal comes back as
 * zero rows.
 *
 * `edited_at` is stamped here rather than left to the client, so an edit can
 * always be told from the original.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const { id: taskId, commentId } = await params
  uuidSchema.parse(taskId)
  const id = uuidSchema.parse(commentId)

  const input = await parseBody(request, updateCommentSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('task_comments')
    .update({ body: input.body, edited_at: new Date().toISOString() })
    .eq('id', id)
    .eq('task_id', taskId)
    .is('deleted_at', null)
    .select('id, edited_at')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('You can only edit your own comments.', 403)

  return jsonOk({ ok: true, edited_at: data.edited_at })
}

/**
 * Remove a comment.
 *
 * SOFT by default: the row stays and `deleted_at` is set, so a thread keeps its
 * shape and the replies underneath a removed question do not silently become
 * answers to whatever precedes it. The UI renders a tombstone.
 *
 * Which write is attempted depends on who is asking, and both are decided by
 * policy rather than here:
 *
 *   the author  — an UPDATE, allowed by `task_comments_update`.
 *   the org     — the same UPDATE, which their own policy does NOT allow (they
 *                 may not edit others' words), so it falls through to a real
 *                 DELETE, which `task_comments_delete` does allow. Moderation
 *                 removes; it does not rewrite.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const { id: taskId, commentId } = await params
  uuidSchema.parse(taskId)
  const id = uuidSchema.parse(commentId)

  const supabase = await createSupabaseServerClient()

  const { data: soft } = await supabase
    .from('task_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('task_id', taskId)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()

  if (soft) return jsonOk({ ok: true, mode: 'soft' })

  const { data: hard, error } = await supabase
    .from('task_comments')
    .delete()
    .eq('id', id)
    .eq('task_id', taskId)
    .select('id')

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!hard?.length) return jsonError('You can only remove your own comments.', 403)

  // Audited, unlike posting one: removing somebody else's words is exactly the
  // kind of act a workspace may later need to account for.
  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'task_comment.deleted',
    entity: 'task_comments',
    entityId: id,
    meta: { taskId },
    request,
  })

  return jsonOk({ ok: true, mode: 'hard' })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
