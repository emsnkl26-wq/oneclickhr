import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { paymentConfirmationSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * "I received my pay for this month."
 *
 * THE DIRECTION IS THE FEATURE. Payroll runs in ADP: the money arrives on
 * payday without this product being involved at all. What nobody had was
 * confirmation in one place that each person actually got it — so the employee
 * uploads the proof and the org verifies it, rather than the org uploading a
 * payslip nobody acknowledges.
 *
 * UPSERT rather than insert, on `(tenant_id, employee_id, year, month)`: the org
 * may have opened a `pending` row for the month already, and someone
 * re-uploading a clearer screenshot is correcting the same fact rather than
 * asserting a new one. The guard trigger (026) is what refuses an overwrite once
 * the org has verified it.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, paymentConfirmationSchema)

  if (!keyBelongsToTenant(input.fileKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  // A confirmation for a month that has not happened yet is a mistake, not a
  // plan. Compared against the ORG's calendar, since that is whose payroll it is.
  const now = new Date()
  const currentPeriod = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1
  if (input.year * 12 + input.month > currentPeriod) {
    return jsonError('That pay period has not happened yet.', 400)
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('payment_confirmations')
    .upsert(
      {
        tenant_id: ctx.tenantId,
        employee_id: ctx.userId,
        month: input.month,
        year: input.year,
        amount: input.amount,
        currency: input.currency,
        paid_on: input.paidOn ?? null,
        file_url: input.fileKey,
        file_name: input.fileName,
        note: input.note,
        status: 'submitted',
        // A re-upload after a rejection is a fresh attempt, so the old verdict
        // goes with it rather than sitting under a new document.
        review_note: null,
        verified_by: null,
        verified_at: null,
        uploaded_by: ctx.userId,
      },
      { onConflict: 'tenant_id,employee_id,year,month' }
    )
    .select('id')
    .single()

  if (error) {
    // The guard trigger's refusal, in the one case a person can actually cause:
    // uploading over a month the org has already verified.
    if (/already been verified/i.test(error.message)) {
      return jsonError(
        'This month has already been verified by your organization and can no longer be changed.',
        409
      )
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'payment.confirmed',
    entity: 'payment_confirmations',
    entityId: data.id,
    meta: { month: input.month, year: input.year },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
