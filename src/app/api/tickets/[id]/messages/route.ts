import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ticketMessageSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { notifyEmployee } from '@/lib/notify'
import { truncate } from '@/lib/utils'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Post a reply. One route for both sides of the conversation.
 *
 * A thread is a single sequence of messages, so splitting this into an employee
 * route and an org route would be two implementations of the same insert that
 * could drift apart. The asymmetry that does exist is expressed where it
 * belongs: `ticket_messages_insert` requires `author_id = auth.uid()` and either
 * org membership or ownership of the ticket, so an employee can only ever reply
 * to their own.
 *
 * The employee is notified when the ORG replies. The reverse direction needs no
 * notification: the ticket rises in the org's queue by `last_activity_at`, which
 * the message trigger bumps.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, ticketMessageSchema)

  if (input.attachmentKey && !keyBelongsToTenant(input.attachmentKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  // RLS scopes this: an employee sees only their own tickets, so a ticket id
  // belonging to a colleague is simply a 404.
  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, code, subject, status, employee_id')
    .eq('id', id)
    .maybeSingle()

  if (!ticket) return jsonError('That ticket was not found.', 404)
  if (ticket.status === 'closed') {
    return jsonError('This ticket is closed. Raise a new one to continue.', 409)
  }

  const { data: message, error } = await supabase
    .from('ticket_messages')
    .insert({
      tenant_id: ctx.tenantId,
      ticket_id: id,
      author_id: ctx.userId,
      author_role: ctx.role,
      body: input.body,
      attachment_url: input.attachmentKey,
      attachment_name: input.attachmentName,
    })
    .select('id, created_at')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  /*
   * An org reply also moves a fresh ticket to `in_progress`. Someone has picked
   * it up — saying so is more honest than leaving it in the same bucket as the
   * ones nobody has looked at, and it saves a second click on every reply.
   */
  if (ctx.role === 'org') {
    if (ticket.status === 'open') {
      await supabase.from('tickets').update({ status: 'in_progress' }).eq('id', id)
    }
    await notifyEmployee(supabase, {
      tenantId: ctx.tenantId,
      employeeId: ticket.employee_id,
      createdBy: ctx.userId,
      title: `New reply on ticket ${ticket.code}`,
      description: truncate(input.body, 240),
    })
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'ticket.replied',
    entity: 'tickets',
    entityId: id,
    meta: { code: ticket.code, role: ctx.role },
    request,
  })

  return jsonOk({ id: message.id, createdAt: message.created_at }, 201)
}

export const POST = withErrorHandler(handlePOST)
