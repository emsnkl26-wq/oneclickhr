import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { todayIn } from '@/lib/time'
import { invoiceWriteSchema, resolvePaidAt, payoutColumns } from '../status-fields'
import { computeTotals, normalizeItems } from '@/lib/invoice'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, invoiceWriteSchema)
  // "Paid" means fully collected: the amount received follows the total rather
  // than leaving a paid invoice with a balance still showing.
  const draftTotals = computeTotals(input.items, input.taxPercent, 0)
  const amountPaid = input.status === 'paid' ? draftTotals.total : input.amountPaid
  const totals = computeTotals(input.items, input.taxPercent, amountPaid)
  const today = todayIn(ctx.tenant.timezone)

  const supabase = await createSupabaseServerClient()

  // Who the invoice is for is only changed when the body says so, so the payout
  // figures can be edited without re-sending the link to the person.
  const { employee_id, ...payout } = payoutColumns(input)

  const { data: existing } = await supabase
    .from('invoices')
    .select('paid_at')
    .eq('id', id)
    .maybeSingle()

  const { data, error } = await supabase
    .from('invoices')
    .update({
      invoice_number: input.invoiceNumber,
      bill_to: input.billTo,
      subject: input.subject,
      payment_details: input.paymentDetails,
      items: normalizeItems(input.items),
      currency: input.currency,
      subtotal: totals.subtotal,
      tax_percent: input.taxPercent,
      total: totals.total,
      amount_paid: amountPaid,
      balance_due: totals.balanceDue,
      status: input.status,
      paid_at: resolvePaidAt(input.status, input.paidAt, existing?.paid_at, today),
      issue_date: input.issueDate,
      due_date: input.dueDate ?? null,
      notes: input.notes,
      ...payout,
      ...(input.employeeId !== undefined ? { employee_id } : {}),
    })
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return jsonError('You already have an invoice with that number.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }
  if (!data) return jsonError('That invoice was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'invoice.updated',
    entity: 'invoices',
    entityId: id,
    meta: { invoiceNumber: input.invoiceNumber, total: totals.total, status: input.status },
    request,
  })

  return jsonOk({ ok: true })
}

async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('invoices')
    .select('id, invoice_number')
    .eq('id', id)
    .maybeSingle()
  if (!existing) return jsonError('That invoice was not found.', 404)

  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'invoice.deleted',
    entity: 'invoices',
    entityId: id,
    meta: { invoiceNumber: existing.invoice_number },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
