import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { taskCommentSchema } from '@/lib/schemas'
import { notifyCommented } from '@/lib/task-writes'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Post a comment, or a reply to one.
 *
 * Anyone who can see the card can discuss it — see `app.can_touch_task`. The
 * authorship rules are the `task_comments_insert` policy's: `author_id` must be
 * the session's own id, which is why it is set from `ctx` here and never read
 * from the body.
 *
 * `author_name` and `author_role` are SNAPSHOTS, written once. A thread has to
 * still read correctly after the person who wrote it has left and the profile
 * join comes back empty.
 *
 * Not audited. A comment is not a privileged act, and every one of them already
 * appears in the card's own activity feed, which is where somebody looking for
 * it would look.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const taskId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, taskCommentSchema)
  const supabase = await createSupabaseServerClient()

  const { data: task } = await supabase
    .from('tasks')
    .select('id, title, reference')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) return jsonError('That task was not found.', 404)

  const { data: me } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', ctx.userId)
    .maybeSingle()

  const authorName = me?.full_name || me?.email || 'Someone'

  const { data: comment, error } = await supabase
    .from('task_comments')
    .insert({
      tenant_id: ctx.tenantId,
      task_id: taskId,
      parent_id: input.parentId ?? null,
      author_id: ctx.userId,
      author_name: authorName,
      author_role: ctx.role,
      body: input.body,
    })
    .select('id, created_at')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  // The trigger has already made the author a watcher, so this notifies the
  // people who were following the card BEFORE this comment — which is the set
  // that wanted to hear about it.
  await notifyCommented(supabase, {
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorName: authorName,
    taskId,
    taskTitle: task.reference ? `#${task.reference} ${task.title}` : task.title,
    body: input.body,
  })

  return jsonOk({ id: comment.id, created_at: comment.created_at }, 201)
}

export const POST = withErrorHandler(handlePOST)
