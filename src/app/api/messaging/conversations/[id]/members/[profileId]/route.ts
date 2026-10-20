import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { conversationMemberRoleSchema } from '@/lib/schemas'
import { displayName, systemMessage } from '@/lib/messaging'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; profileId: string }> }

/**
 * Leave a conversation, or remove somebody from one.
 *
 * ONE ENDPOINT FOR BOTH, because they are the same row and the same policy:
 * `conversation_members_delete` admits you deleting your own membership, or an
 * administrator deleting anybody's. Splitting them into "leave" and "remove"
 * would be two handlers that differ only in which id they read from the URL,
 * and a second place for the rule to drift.
 *
 * They are narrated differently, though, because "Priya left" and "Rajesh
 * removed Priya" are not the same event to the people still in the room.
 *
 * A DIRECT MESSAGE CAN BE LEFT. It cannot be deleted and nobody can be removed
 * from it, but somebody who wants out of a conversation is entitled to leave
 * it; what they leave behind is the history, which was never only theirs.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const resolved = await params
  const conversationId = uuidSchema.parse(resolved.id)
  const profileId = uuidSchema.parse(resolved.profileId)
  const supabase = await createSupabaseServerClient()

  const leaving = profileId === ctx.userId

  const { data: room } = await supabase
    .from('conversations')
    .select('id, kind, name')
    .eq('id', conversationId)
    .maybeSingle()
  if (!room) return jsonError('That conversation was not found.', 404)
  if (room.kind === 'direct' && !leaving) {
    return jsonError('Nobody can be removed from a direct conversation.', 400)
  }

  /*
   * The LAST administrator of a room cannot walk out of it.
   *
   * An ownerless group is not a tidy edge case: nobody can rename it, nobody
   * can add the person who should have been in it, and nobody can delete it —
   * it becomes a room that exists forever and cannot be changed. An org admin
   * could still manage it, which is exactly why this refusal names handing over
   * rather than simply saying no.
   */
  if (leaving && room.kind !== 'direct') {
    const { data: admins } = await supabase
      .from('conversation_members')
      .select('profile_id')
      .eq('conversation_id', conversationId)
      .eq('role', 'admin')
    const adminIds = ((admins ?? []) as Array<{ profile_id: string }>).map((row) => row.profile_id)
    if (adminIds.length === 1 && adminIds[0] === ctx.userId) {
      return jsonError(
        'You are the only administrator here. Make somebody else an administrator first, or delete the conversation.',
        409
      )
    }
  }

  // The name is read BEFORE the row goes, because afterwards there is nothing
  // left to join to and the system line would say "removed someone".
  const { data: person } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', profileId)
    .maybeSingle()

  const { error } = await supabase
    .from('conversation_members')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('profile_id', profileId)

  if (error) {
    if (error.code === '42501') {
      return jsonError('Only this conversation’s administrators can remove people.', 403)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  const actor = displayName(ctx)
  const who = person?.full_name || person?.email || 'Someone'
  await systemMessage(
    ctx.tenantId,
    conversationId,
    leaving ? 'members.left' : 'members.removed',
    {
      text: leaving ? `${actor} left` : `${actor} removed ${who}`,
      actorId: ctx.userId,
      profileId,
    }
  )

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: leaving ? 'conversation.left' : 'conversation.member_removed',
    entity: 'conversations',
    entityId: conversationId,
    meta: { profileId },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Make somebody an administrator of this room, or stop them being one.
 *
 * The policy admits the row, and `tg_conversation_members_guard` is what makes
 * the distinction real: a member may write their own row (that is where
 * `last_read_at`, `muted` and `pinned` live) but the trigger refuses a `role`
 * change from anybody who is not already an administrator. Without it, this
 * would be self-service promotion through the preferences endpoint.
 *
 * Nobody may demote THEMSELVES, for the same reason the last administrator
 * cannot leave: it is the one move that can strand a room with no owner, and it
 * reads as a stuck group rather than as a thing somebody did.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const resolved = await params
  const conversationId = uuidSchema.parse(resolved.id)
  const profileId = uuidSchema.parse(resolved.profileId)
  const input = await parseBody(request, conversationMemberRoleSchema)
  const supabase = await createSupabaseServerClient()

  const { data: room } = await supabase
    .from('conversations')
    .select('id, kind, name')
    .eq('id', conversationId)
    .maybeSingle()
  if (!room) return jsonError('That conversation was not found.', 404)
  if (room.kind === 'direct') {
    return jsonError('A direct conversation has no administrators.', 400)
  }
  if (profileId === ctx.userId && input.role === 'member') {
    return jsonError('Ask another administrator to remove your role.', 400)
  }

  const { data: person } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', profileId)
    .maybeSingle()

  const { error } = await supabase
    .from('conversation_members')
    .update({ role: input.role })
    .eq('conversation_id', conversationId)
    .eq('profile_id', profileId)

  if (error) {
    // 42501 from the policy, or P0001 from the guard trigger — both mean the
    // same thing to the person clicking, and neither should quote a trigger.
    if (error.code === '42501' || error.code === 'P0001') {
      return jsonError('Only this conversation’s administrators can change roles.', 403)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  const who = person?.full_name || person?.email || 'Someone'
  await systemMessage(ctx.tenantId, conversationId, 'members.role', {
    text:
      input.role === 'admin'
        ? `${displayName(ctx)} made ${who} an administrator`
        : `${displayName(ctx)} removed ${who} as an administrator`,
    actorId: ctx.userId,
    profileId,
    role: input.role,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
