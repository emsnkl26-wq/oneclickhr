import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, parseQuery, jsonOk, jsonError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { messageHistorySchema, messageSchema } from '@/lib/schemas'
import {
  conversationRoster,
  loadOlderMessages,
  MessagingError,
  notifyNewMessage,
  sendMessage,
} from '@/lib/messaging'
import { mentionedIds, messageKindFor, attachmentKindFor } from '@/lib/messaging-shared'
import { keyBelongsToTenant } from '@/lib/r2'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { isVoiceMime } from '@/lib/upload-policy'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * An older page of the thread — the infinite scroll upwards.
 *
 * `before` is the oldest timestamp the client already holds, and the query is
 * strictly less than it, so paging can neither re-serve a message the reader
 * has nor skip one between pages.
 */
async function handleGET(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const conversationId = uuidSchema.parse((await params).id)
  const query = parseQuery(request, messageHistorySchema)
  const supabase = await createSupabaseServerClient()

  const page = await loadOlderMessages(supabase, gate.ctx, conversationId, {
    before: query.before,
    limit: query.limit,
  })
  return jsonOk(page)
}

/**
 * Send a message.
 *
 * WHAT THIS HANDLER IS RESPONSIBLE FOR, given that `messages_insert` already
 * proves authorship, membership, the posting policy and that the room is not
 * archived:
 *
 *   1. THE ATTACHMENT KEYS. They came back from a browser, so each one is
 *      re-proven to start with the caller's own tenant prefix. Without that
 *      test a crafted request could hang another tenant's object off a message
 *      — `/api/files/view` would refuse to serve it, so the damage is a broken
 *      bubble rather than a leak, but a row pointing at somebody else's file is
 *      not a row to write.
 *
 *   2. THE VOICE FLAG. `attachmentKindFor` cannot tell a voice note from an
 *      attached video: a browser's recorder writes Opus into a WebM container,
 *      so both arrive as `video/webm` (see `VOICE_MIMES`). The flag comes from
 *      `isVoiceMime` plus the single-attachment shape a recording always has,
 *      rather than from the request, because a client that could label its own
 *      attachments could make a 40MB video render as a voice bubble.
 *
 *   3. THE RATE LIMIT. Generous — 120 a minute is faster than anybody types —
 *      and present because this is the one authenticated endpoint in the
 *      product that is cheap to call and writes a row every time.
 *
 * The notification fan-out happens after the row exists and never throws, so a
 * message that delivered but failed to notify is still a message that
 * delivered.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await rateLimit(limitKey('message:send', ctx.userId), 120, 60 * 1000)
  if (!limited.ok) return jsonError('You are sending messages too quickly.', 429)

  const conversationId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, messageSchema)
  const supabase = await createSupabaseServerClient()

  for (const attachment of input.attachments) {
    if (!keyBelongsToTenant(attachment.key, ctx.tenantId)) {
      return jsonError('That attachment does not belong to this workspace.', 403)
    }
  }

  /*
   * A recording is exactly one audio-ish attachment and no text body. Anything
   * else carrying the same container is somebody attaching a video, and is
   * rendered as a file.
   */
  const isRecording =
    input.attachments.length === 1 && !input.body && isVoiceMime(input.attachments[0].contentType)

  const attachments = input.attachments.map((attachment) => ({
    key: attachment.key,
    name: attachment.name,
    contentType: attachment.contentType,
    sizeBytes: attachment.sizeBytes,
    durationSeconds: attachment.durationSeconds,
    width: attachment.width,
    height: attachment.height,
    voice: isRecording,
  }))

  const { data: room } = await supabase
    .from('conversations')
    .select('id, kind, name')
    .eq('id', conversationId)
    .maybeSingle()
  if (!room) return jsonError('That conversation was not found.', 404)

  try {
    const sent = await sendMessage(supabase, ctx, conversationId, {
      body: input.body,
      replyToId: input.replyToId ?? null,
      attachments,
      clientToken: input.clientToken,
    })

    const roster = await conversationRoster(supabase, conversationId)
    await notifyNewMessage(supabase, ctx, {
      conversationId,
      conversationKind: room.kind,
      conversationName: room.name,
      body: input.body,
      kind: messageKindFor(
        attachments.map((attachment) => ({
          kind: attachmentKindFor(attachment.contentType, attachment.voice),
        }))
      ),
      mentions: mentionedIds(input.body, roster),
    })

    return jsonOk(sent, 201)
  } catch (err) {
    if (err instanceof MessagingError) return jsonError(err.message, err.status)
    throw err
  }
}

export const GET = withErrorHandler(handleGET)
export const POST = withErrorHandler(handlePOST)
