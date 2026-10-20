import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { conversationMembersSchema } from '@/lib/schemas'
import { displayName, systemMessage } from '@/lib/messaging'
import { notifyEmployee } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Add people to a group or a project room.
 *
 * `conversation_members_insert` is the gate, and it resolves to
 * `app.is_conversation_admin` — the room's own administrators, or an org admin
 * for any room. A DIRECT MESSAGE IS REFUSED BY THE DATABASE whatever this
 * handler does (`tg_conversation_members_guard`); the early return below exists
 * to say so in a sentence instead of surfacing a raised exception.
 *
 * EVERY ADDITION IS NARRATED. That is not decoration: it is the counterweight
 * to an org administrator being able to add themselves to any room. They can,
 * and the room sees it happen, in its own history, permanently — which is the
 * difference between workspace custody and reading over somebody's shoulder.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const conversationId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, conversationMembersSchema)
  const supabase = await createSupabaseServerClient()

  const { data: room } = await supabase
    .from('conversations')
    .select('id, kind, name')
    .eq('id', conversationId)
    .maybeSingle()
  if (!room) return jsonError('That conversation was not found.', 404)
  if (room.kind === 'direct') {
    return jsonError(
      'A direct conversation is between two people. Start a group to include more.',
      400
    )
  }

  /*
   * Who these people are, confirmed against the workspace rather than taken
   * from the request. The names are needed for the system line anyway, so the
   * check costs nothing extra — and it runs on the CALLER'S client, which means
   * `profiles_select` is what decides the ids are real and in this tenant.
   */
  const { data: people } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', input.profileIds)
    .eq('is_active', true)

  const found = (people ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>
  if (found.length !== input.profileIds.length) {
    return jsonError('One of those people is no longer in this workspace.', 400)
  }

  const { error } = await supabase.from('conversation_members').insert(
    found.map((person) => ({
      conversation_id: conversationId,
      profile_id: person.id,
      tenant_id: ctx.tenantId,
      role: 'member' as const,
      added_by: ctx.userId,
    }))
  )

  if (error) {
    if (error.code === '42501') {
      return jsonError('Only this conversation’s administrators can add people.', 403)
    }
    if (error.code === '23505') return jsonError('They are already in this conversation.', 409)
    return jsonError(friendlyDbError(error), 400)
  }

  const actor = displayName(ctx)
  const names = found.map((person) => person.full_name || person.email || 'someone')
  await systemMessage(ctx.tenantId, conversationId, 'members.added', {
    text: `${actor} added ${names.join(', ')}`,
    actorId: ctx.userId,
    profileIds: found.map((person) => person.id),
  })

  /*
   * Being added is how somebody finds out there is a room to look at, so each
   * new member gets a notification — but only the new members. The room's
   * existing people have the system line in their thread, which is where they
   * will see it, and a push for every addition would make a reorganisation of a
   * fifty-person group fifty alerts to forty-nine people who did not move.
   */
  await Promise.all(
    found.map((person) =>
      notifyEmployee(supabase, {
        tenantId: ctx.tenantId,
        employeeId: person.id,
        title: room.name || 'A conversation',
        description: `${actor} added you to this ${room.kind === 'project' ? 'project room' : 'group'}`,
        createdBy: ctx.userId,
        event: 'message.received',
        subjectId: conversationId,
      })
    )
  )

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'conversation.members_added',
    entity: 'conversations',
    entityId: conversationId,
    meta: { added: found.map((person) => person.id) },
    request,
  })

  return jsonOk({ added: found.length }, 201)
}

export const POST = withErrorHandler(handlePOST)
