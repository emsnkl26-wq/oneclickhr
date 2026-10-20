import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { messagePinSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ messageId: string }> }

/**
 * Pin a message to the top of its conversation, or unpin it.
 *
 * A PIN IS THE ROOM'S, NOT THE READER'S — unlike muting and pinning a
 * CONVERSATION, which live on the membership row because they are one person's
 * preference. Pinning a message is "this is the address / the deadline / the
 * decision", and it is only worth anything if everybody sees the same strip.
 *
 * So it is written to the message and gated by `messages_update`, which admits
 * the sender and the room's administrators. An ordinary member pinning for
 * everybody would make the strip a free-for-all; the sender being allowed to
 * pin their own is what lets somebody put the meeting link up without having to
 * find an administrator.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const messageId = uuidSchema.parse((await params).messageId)
  const input = await parseBody(request, messagePinSchema)
  const supabase = await createSupabaseServerClient()

  const { data: message } = await supabase
    .from('messages')
    .select('id, deleted_at')
    .eq('id', messageId)
    .maybeSingle()

  if (!message) return jsonError('That message was not found.', 404)
  if (message.deleted_at) return jsonError('That message was deleted.', 400)

  const { error } = await supabase
    .from('messages')
    .update(
      input.pinned
        ? { pinned_at: new Date().toISOString(), pinned_by: ctx.userId }
        : { pinned_at: null, pinned_by: null }
    )
    .eq('id', messageId)

  if (error) {
    if (error.code === '42501') {
      return jsonError('Only the sender or an administrator can pin this.', 403)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
