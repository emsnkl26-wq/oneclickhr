import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ticketSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Raise a help-desk ticket.
 *
 * The opening message lives on the ticket row itself rather than as the first
 * `ticket_messages` entry. That is deliberate: `ticket_messages` has no UPDATE
 * policy, so a thread is append-only — but the request that STARTED the thread
 * is also what the org's queue lists and filters on, and it belongs next to the
 * subject it summarises.
 *
 * Rate-limited per user: a ticket sends work to a human, and an accidental
 * double-submit or a stuck retry loop should not fill someone's queue.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await rateLimit(limitKey('ticket', ctx.userId), 20, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have raised a lot of tickets recently. Please try again later.', 429)
  }

  const input = await parseBody(request, ticketSchema)

  if (input.attachmentKey && !keyBelongsToTenant(input.attachmentKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('tickets')
    .insert({
      tenant_id: ctx.tenantId,
      employee_id: ctx.userId,
      subject: input.subject,
      description: input.description,
      priority: input.priority,
      status: 'open',
      attachment_url: input.attachmentKey,
      attachment_name: input.attachmentName,
    })
    .select('id, code')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'ticket.created',
    entity: 'tickets',
    entityId: data.id,
    meta: { code: data.code, priority: input.priority },
    request,
  })

  return jsonOk({ id: data.id, code: data.code }, 201)
}

export const POST = withErrorHandler(handlePOST)
