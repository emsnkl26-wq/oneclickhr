import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ticketStatusSchema } from '@/lib/schemas'
import { notifyEmployee } from '@/lib/notify'
import { humanize } from '@/lib/utils'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Move a ticket through its states — org only.
 *
 * `tickets_update` grants UPDATE to org users alone, so an employee cannot close
 * a ticket the org is still working on, or reopen one it has resolved. What they
 * can do is reply, and a reply bumps `last_activity_at` so a resolved ticket
 * with a new question on it rises back to the top of the queue on its own.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, ticketStatusSchema)
  const supabase = await createSupabaseServerClient()

  const { data: ticket } = await supabase
    .from('tickets')
    .select('id, code, subject, status, employee_id')
    .eq('id', id)
    .maybeSingle()

  if (!ticket) return jsonError('That ticket was not found.', 404)
  if (ticket.status === input.status) return jsonOk({ ok: true, unchanged: true })

  const { error } = await supabase
    .from('tickets')
    .update({ status: input.status, last_activity_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return jsonError(friendlyDbError(error), 400)

  await notifyEmployee(supabase, {
    tenantId: ctx.tenantId,
    employeeId: ticket.employee_id,
    createdBy: ctx.userId,
    title: `Ticket ${ticket.code} is now ${humanize(input.status).toLowerCase()}`,
    description: ticket.subject,
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'ticket.status_changed',
    entity: 'tickets',
    entityId: id,
    meta: { code: ticket.code, from: ticket.status, to: input.status },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
