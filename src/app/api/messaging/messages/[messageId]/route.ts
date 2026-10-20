import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { messageEditSchema } from '@/lib/schemas'
import { conversationRoster } from '@/lib/messaging'
import { mentionedIds } from '@/lib/messaging-shared'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ messageId: string }> }

/**
 * Edit a message.
 *
 * `messages_update` admits the sender and the room's administrators;
 * `tg_messages_guard` confines the change to the body, the retraction and the
 * pin, so nothing here has to defend who sent it or which room it is in.
 *
 * MENTIONS ARE RE-RESOLVED. Edit "@Priya can you look" into "@Rajesh can you
 * look" and the stored id set has to follow, or the thread highlights Rajesh
 * while the column still says Priya — and the next person to read `mentions`
 * (a digest, a filter, an "@ mentions" view) is reading a lie. No new
 * notification is sent: an edit is not an event, and silently paging somebody
 * by rewriting an old message is a thing people would notice and dislike.
 *
 * An administrator may not rewrite somebody else's words. Retracting is theirs;
 * editing is not, and the refusal is explicit rather than left to the policy —
 * which, by design, admits both.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const messageId = uuidSchema.parse((await params).messageId)
  const input = await parseBody(request, messageEditSchema)
  const supabase = await createSupabaseServerClient()

  const { data: message } = await supabase
    .from('messages')
    .select('id, conversation_id, sender_id, deleted_at, kind')
    .eq('id', messageId)
    .maybeSingle()

  if (!message) return jsonError('That message was not found.', 404)
  if (message.sender_id !== ctx.userId) {
    return jsonError('You can only edit your own messages.', 403)
  }
  if (message.deleted_at) return jsonError('That message was deleted.', 400)
  if (message.kind === 'system') return jsonError('That message cannot be edited.', 400)

  const roster = await conversationRoster(supabase, message.conversation_id as string)

  const { error } = await supabase
    .from('messages')
    .update({
      body: input.body,
      mentions: mentionedIds(input.body, roster),
      edited_at: new Date().toISOString(),
    })
    .eq('id', messageId)

  if (error) return jsonError(friendlyDbError(error), 400)
  return jsonOk({ ok: true })
}

/**
 * Retract a message.
 *
 * A SOFT DELETE, and the body is blanked in the same statement. The row has to
 * survive — replies quote it, and a gap in a thread reads as a bug — but the
 * text must not, because "deleted for everyone" that leaves the words in the
 * database is a promise broken by the next query someone writes.
 *
 * `tg_messages_after_write` rewrites the conversation's preview when the
 * retracted message was the last one, so the sidebar does not keep showing a
 * line its sender has taken back.
 *
 * AN ADMINISTRATOR MAY RETRACT ANYBODY'S. That is moderation, it is what the
 * policy says, and it is the counterpart to not being able to EDIT them: a room
 * admin can remove something that should not be there and cannot put words in
 * somebody's mouth.
 */
async function handleDELETE(_request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const messageId = uuidSchema.parse((await params).messageId)
  const supabase = await createSupabaseServerClient()

  const { data: message } = await supabase
    .from('messages')
    .select('id, deleted_at, kind')
    .eq('id', messageId)
    .maybeSingle()

  if (!message) return jsonError('That message was not found.', 404)
  if (message.kind === 'system') return jsonError('That message cannot be deleted.', 400)
  // Already gone. Answering ok keeps a double-click from showing an error for
  // something that is in exactly the state the clicker wanted.
  if (message.deleted_at) return jsonOk({ ok: true })

  const { error } = await supabase
    .from('messages')
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: gate.ctx.userId,
      body: null,
      mentions: [],
      pinned_at: null,
      pinned_by: null,
    })
    .eq('id', messageId)

  if (error) {
    if (error.code === '42501') {
      return jsonError('You can only delete your own messages.', 403)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  /*
   * The attachment ROWS go too, so the photo stops being reachable the moment
   * the message is retracted: `/api/files/view` answers a `chat-` key by asking
   * whether a `message_attachments` row the caller can see references it, and
   * with no row the answer is no. The stored objects remain against the
   * workspace's quota, like every other orphan, rather than this handler making
   * a best-effort pass at R2 from inside a request that has already succeeded.
   */
  await supabase.from('message_attachments').delete().eq('message_id', messageId)

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
