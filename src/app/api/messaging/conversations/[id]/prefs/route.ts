import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { conversationPrefsSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Mute or pin a conversation, for the caller only.
 *
 * These are the two columns on `conversation_members` that belong to the READER
 * rather than to the room, which is why they have their own endpoint: pinning a
 * group for yourself must not move it for anybody else, and neither is a thing
 * an administrator does TO somebody.
 *
 * The update is pinned to `profile_id = ctx.userId` as well as being held there
 * by the policy. Belt and braces, and cheap: this is the one write in the
 * feature where forgetting the clause would silently change a setting for every
 * person in the room.
 *
 * MUTING NEVER HIDES THE UNREAD COUNT. `messaging_unread()` does not look at
 * this column at all — mute is about the push and the email, and a muted room
 * that also stopped counting is how people miss things they asked to be quiet
 * rather than invisible. A mention beats the mute (see `notifyNewMessage`).
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const conversationId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, conversationPrefsSchema)
  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = {}
  if (input.muted !== undefined) patch.muted = input.muted
  if (input.pinned !== undefined) patch.pinned = input.pinned

  const { data, error } = await supabase
    .from('conversation_members')
    .update(patch)
    .eq('conversation_id', conversationId)
    .eq('profile_id', ctx.userId)
    .select('conversation_id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('You are not in that conversation.', 404)

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
