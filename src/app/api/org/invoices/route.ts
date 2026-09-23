import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { todayIn } from '@/lib/time'
import { invoiceWriteSchema, resolvePaidAt, payoutColumns } from './status-fields'
import { computeTotals, normalizeItems } from '@/lib/invoice'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Create an invoice.
 *
 * Totals are RECOMPUTED here from the line items rather than accepted from the
 * client. The form shows a live preview using the same helper, so the numbers
 * always agree — but the stored figure is the one this server derived.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, invoiceWriteSchema)
  // "Paid" means fully collected: the amount received follows the total rather
  // than leaving a paid invoice with a balance still showing.
  const draftTotals = computeTotals(input.items, input.taxPercent, 0)
  const amountPaid = input.status === 'paid' ? draftTotals.total : input.amountPaid
  const totals = computeTotals(input.items, input.taxPercent, amountPaid)
  const today = todayIn(ctx.tenant.timezone)

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      tenant_id: ctx.tenantId,
      invoice_number: input.invoiceNumber,
      invoice_type: input.invoiceType,
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
      paid_at: resolvePaidAt(input.status, input.paidAt, null, today),
      issue_date: input.issueDate,
      due_date: input.dueDate ?? null,
      notes: input.notes,
      vendor_id: input.vendorId ?? null,
      ...payoutColumns(input),
      created_by: ctx.userId,
    })
    .select('id, invoice_number')
    .single()

  if (error) {
    if (error.code === '23505') {
      return jsonError('You already have an invoice with that number.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'invoice.created',
    entity: 'invoices',
    entityId: data.id,
    meta: { invoiceNumber: data.invoice_number, total: totals.total },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
