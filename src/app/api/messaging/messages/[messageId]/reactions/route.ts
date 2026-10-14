import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { reactionSchema } from '@/lib/schemas'
import { rateLimit, limitKey } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ messageId: string }> }

/**
 * React to a message, or take the reaction back.
 *
 * TWO VERBS, NOT A TOGGLE, and that is deliberate. A toggle endpoint has to
 * read the current state and then write the opposite, which means two people
 * double-tapping the same emoji in the same second can land in either order and
 * end with the reaction on or off at random. POST is "it is there" and DELETE is
 * "it is not"; both are idempotent, so the client can send whichever state its
 * optimistic chip has already drawn and the server will agree.
 *
 * `on conflict do nothing` is what makes POST idempotent — the primary key
 * (message, person, emoji) already says one person reacts with one emoji once,
 * so a repeat is not an error to report.
 *
 * NOT NOTIFIED. A reaction is the quietest thing in the product and the whole
 * reason people use one instead of replying "ok": it acknowledges without
 * interrupting. Pushing it would remove the only difference between the two.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  // A tight loop of taps is cheap for the client and a row per tap for us.
  const limited = await rateLimit(limitKey('message:react', ctx.userId), 240, 60 * 1000)
  if (!limited.ok) return jsonError('Too many reactions. Please slow down.', 429)

  const messageId = uuidSchema.parse((await params).messageId)
  const input = await parseBody(request, reactionSchema)
  const supabase = await createSupabaseServerClient()

  // `conversation_id` has to come off the message: the reaction row carries it
  // so RLS can be answered without a join, and it must be the message's own.
  const { data: message } = await supabase
    .from('messages')
    .select('id, conversation_id, deleted_at')
    .eq('id', messageId)
    .maybeSingle()

  if (!message) return jsonError('That message was not found.', 404)
  if (message.deleted_at) return jsonError('That message was deleted.', 400)

  const { error } = await supabase.from('message_reactions').upsert(
    {
      message_id: messageId,
      profile_id: ctx.userId,
      emoji: input.emoji,
      tenant_id: ctx.tenantId,
      conversation_id: message.conversation_id,
    },
    { onConflict: 'message_id,profile_id,emoji', ignoreDuplicates: true }
  )

  if (error) {
    if (error.code === '42501') {
      return jsonError('You cannot react in this conversation.', 403)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  return jsonOk({ ok: true }, 201)
}

async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const messageId = uuidSchema.parse((await params).messageId)
  const input = await parseBody(request, reactionSchema)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('profile_id', ctx.userId)
    .eq('emoji', input.emoji)

  if (error) return jsonError(friendlyDbError(error), 400)
  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
export const DELETE = withErrorHandler(handleDELETE)
