import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { conversationSchema } from '@/lib/schemas'
import { createConversation, listConversations, MessagingError } from '@/lib/messaging'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Every conversation the caller can see.
 *
 * Exists alongside the server-rendered page because the LIST is live: a message
 * arriving in a room the reader is not looking at has to move it to the top and
 * raise its badge, and a Realtime event is the signal to re-read this rather
 * than to patch a count the client cannot recompute.
 *
 * `no-store`, and it has to be: a cached conversation list is a cached unread
 * count, which is the one number in the product that must never be stale in the
 * reader's favour.
 */
async function handleGET() {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const supabase = await createSupabaseServerClient()
  const { conversations, people, error } = await listConversations(supabase, gate.ctx)
  if (error) return jsonError('Your conversations could not be loaded.', 500)

  return jsonOk({ conversations, people })
}

/**
 * Start a conversation — a direct message, a group, or a project room.
 *
 * `created: false` means it already existed, which only happens for a direct
 * message and is the whole point of `direct_key`: "message Priya" opens the
 * thread with Priya, every time, rather than a second one with half the history
 * in it. The caller treats both answers the same way and navigates to the id.
 *
 * AUDITED FOR ROOMS, NOT FOR DIRECT MESSAGES. Creating a group is a change to
 * the workspace's shape and belongs in the log an administrator reads; opening
 * a DM with a colleague is not an administrative act, and recording who started
 * talking to whom would turn the audit trail into the surveillance log that
 * 062's privacy rule exists to prevent.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await rateLimit(limitKey('conversation:new', ctx.userId), 30, 10 * 60 * 1000)
  if (!limited.ok) return jsonError('Too many new conversations. Please wait a moment.', 429)

  const input = await parseBody(request, conversationSchema)
  const supabase = await createSupabaseServerClient()

  try {
    const result = await createConversation(supabase, ctx, {
      kind: input.kind,
      name: input.name ?? null,
      description: input.description,
      color: input.color ?? null,
      posting: input.posting,
      projectId: input.projectId ?? null,
      withProfileId: input.withProfileId ?? null,
      memberIds: input.memberIds,
    })

    if (input.kind !== 'direct' && result.created) {
      await audit({
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        actorEmail: ctx.email,
        action: 'conversation.created',
        entity: 'conversations',
        entityId: result.id,
        meta: { kind: input.kind, name: input.name, members: input.memberIds.length + 1 },
        request,
      })
    }

    return jsonOk(result, result.created ? 201 : 200)
  } catch (err) {
    if (err instanceof MessagingError) return jsonError(err.message, err.status)
    throw err
  }
}

export const GET = withErrorHandler(handleGET)
export const POST = withErrorHandler(handlePOST)
