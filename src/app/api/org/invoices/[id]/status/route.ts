import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { todayIn } from '@/lib/time'
import { audit } from '@/lib/audit'
import { invoiceStatusSchema, resolvePaidAt } from '../../status-fields'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const cents = (value: number) => Math.round(value * 100)

/**
 * Set an invoice's status without resubmitting the whole document — the
 * "Mark as paid" action on the list.
 *
 * The money follows the status: `paid` records the full total as received,
 * `partially_paid` takes the amount received so far (which must be above zero
 * and below the total), and the balance is recomputed from those. Everything
 * else leaves `amount_paid` alone.
 *
 * Tenant scope is RLS's job, as on every other invoice route — the row simply
 * is not visible to another workspace, so it comes back as "not found".
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, invoiceStatusSchema)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, invoice_number, total, amount_paid, paid_at, status')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return jsonError('That invoice was not found.', 404)

  const total = Number(existing.total) || 0
  let amountPaid = Number(existing.amount_paid) || 0

  if (input.status === 'paid') {
    amountPaid = total
  } else if (input.status === 'partially_paid') {
    const received = input.amountPaid ?? amountPaid
    if (received <= 0 || cents(received) >= cents(total)) {
      return jsonError(
        'For a partial payment, enter an amount above zero and below the invoice total.',
        400
      )
    }
    amountPaid = received
  }

  const balanceDue = Math.max(0, cents(total) - cents(amountPaid)) / 100
  const today = todayIn(ctx.tenant.timezone)
  const paidAt = resolvePaidAt(input.status, input.paidAt, existing.paid_at, today)

  const { error } = await supabase
    .from('invoices')
    .update({
      status: input.status,
      amount_paid: amountPaid,
      balance_due: balanceDue,
      paid_at: paidAt,
    })
    .eq('id', id)

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'invoice.status_changed',
    entity: 'invoices',
    entityId: id,
    meta: {
      invoiceNumber: existing.invoice_number,
      from: existing.status,
      to: input.status,
      paidAt,
      amountPaid,
    },
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
