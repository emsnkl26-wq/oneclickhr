import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, parseQuery, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { conversationUpdateSchema, messageHistorySchema } from '@/lib/schemas'
import { displayName, loadConversation, systemMessage } from '@/lib/messaging'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** One conversation and a page of its history. */
async function handleGET(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const conversationId = uuidSchema.parse((await params).id)
  const query = parseQuery(request, messageHistorySchema)
  const supabase = await createSupabaseServerClient()

  const detail = await loadConversation(supabase, gate.ctx, conversationId, {
    before: query.before,
    limit: query.limit,
  })
  if (!detail) return jsonError('That conversation was not found.', 404)

  return jsonOk(detail)
}

/**
 * Rename, re-describe, re-colour, re-picture, archive, change who may post.
 *
 * `conversations_update` is the gate (`app.is_conversation_admin`), so this
 * handler does not re-decide who may do it — it decides what the change MEANS,
 * which is the part a policy cannot express: a new name is narrated into the
 * room, and an archive is narrated differently from an unarchive.
 *
 * `avatarKey` is re-proven against the caller's own tenant prefix before it is
 * stored. The key came back from a browser, and a browser can change it; the
 * worst it could otherwise do is point a group's picture at another tenant's
 * object, which `/api/files/view` would refuse to serve — a broken image rather
 * than a leak, and still not something to write to a row.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const conversationId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, conversationUpdateSchema)
  const supabase = await createSupabaseServerClient()

  const { data: before } = await supabase
    .from('conversations')
    .select('id, kind, name, archived_at, posting')
    .eq('id', conversationId)
    .maybeSingle()
  if (!before) return jsonError('That conversation was not found.', 404)

  if (before.kind === 'direct') {
    return jsonError('A direct conversation has nothing to rename.', 400)
  }

  /*
   * ABSENT MEANS LEAVE IT, `null` MEANS CLEAR IT. See the box on
   * `conversationUpdateSchema` for why that distinction had to be designed in
   * rather than assumed: with the project's usual `optionalText` helper every
   * field arrives as `null` when omitted, and saving one setting would have
   * erased the two text fields beside it.
   */
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.description !== undefined) patch.description = input.description || null
  if (input.color !== undefined) patch.color = input.color
  if (input.posting !== undefined) patch.posting = input.posting
  if (input.archived !== undefined) {
    patch.archived_at = input.archived ? new Date().toISOString() : null
  }
  if (input.avatarKey !== undefined) {
    if (input.avatarKey && !keyBelongsToTenant(input.avatarKey, ctx.tenantId)) {
      return jsonError('That picture does not belong to this workspace.', 403)
    }
    patch.avatar_url = input.avatarKey || null
  }

  const { error } = await supabase.from('conversations').update(patch).eq('id', conversationId)
  if (error) {
    // 42501 is the policy refusing: they are not an administrator of this room.
    if (error.code === '42501') {
      return jsonError('Only this conversation’s administrators can change it.', 403)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  /*
   * Narrate only what the room would notice. A colour change is a preference;
   * a rename, an archive and a change to who may post are facts the people in
   * the room need in their history, which is where they will look when they
   * wonder why they can no longer reply.
   */
  const actor = displayName(ctx)
  if (input.name !== undefined && input.name !== before.name) {
    await systemMessage(ctx.tenantId, conversationId, 'conversation.renamed', {
      text: `${actor} renamed this to “${input.name}”`,
      actorId: ctx.userId,
      from: before.name,
      to: input.name,
    })
  }
  if (input.archived !== undefined && input.archived !== !!before.archived_at) {
    await systemMessage(ctx.tenantId, conversationId, 'conversation.archived', {
      text: input.archived
        ? `${actor} archived this conversation — it is now read-only`
        : `${actor} reopened this conversation`,
      actorId: ctx.userId,
    })
  }
  if (input.posting !== undefined && input.posting !== before.posting) {
    await systemMessage(ctx.tenantId, conversationId, 'conversation.posting', {
      text:
        input.posting === 'admins'
          ? `${actor} limited posting to administrators`
          : `${actor} opened posting to everyone`,
      actorId: ctx.userId,
    })
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'conversation.updated',
    entity: 'conversations',
    entityId: conversationId,
    meta: { changed: Object.keys(patch) },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete a conversation and everything in it.
 *
 * `conversations_delete` admits a room's administrators and the org, and a
 * DIRECT MESSAGE HAS NEITHER — both sides are plain members, deliberately, so
 * neither person can destroy a history half of which is not theirs. The explicit
 * refusal below is there to say that in words rather than as a 403 from a policy
 * nobody can read from the browser.
 *
 * The cascades in 062 take the messages, attachments and reactions with it. The
 * stored OBJECTS are not swept here — they are counted against the workspace's
 * quota and collected the same way every other orphan is, rather than having a
 * delete handler make its own best-effort attempt at R2 while the row is gone.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const conversationId = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: room } = await supabase
    .from('conversations')
    .select('id, kind, name')
    .eq('id', conversationId)
    .maybeSingle()
  if (!room) return jsonError('That conversation was not found.', 404)
  if (room.kind === 'direct') {
    return jsonError('A direct conversation cannot be deleted. You can leave it instead.', 400)
  }

  const { error } = await supabase.from('conversations').delete().eq('id', conversationId)
  if (error) {
    if (error.code === '42501') {
      return jsonError('Only this conversation’s administrators can delete it.', 403)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'conversation.deleted',
    entity: 'conversations',
    entityId: conversationId,
    meta: { kind: room.kind, name: room.name },
    request,
  })

  return jsonOk({ ok: true })
}

export const GET = withErrorHandler(handleGET)
export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
