import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { reviewPaymentSchema } from '@/lib/schemas'
import { notifyEmployee } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Verify — or send back — a payment confirmation.
 *
 * `.eq('status', 'submitted')` on the update makes the decision idempotent, the
 * same way timesheet review does: two admins working the same month cannot both
 * record a verdict, and a double-click is a conflict rather than a silent
 * overwrite of the first decision.
 *
 * A rejection ALWAYS carries a note (`reviewPaymentSchema` refuses one without)
 * because the employee's next action depends entirely on why: a wrong month, an
 * unreadable screenshot and a disputed amount need three different responses.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, reviewPaymentSchema)
  const supabase = await createSupabaseServerClient()

  const { data: row } = await supabase
    .from('payment_confirmations')
    .select('id, employee_id, month, year, status')
    .eq('id', id)
    .maybeSingle()

  if (!row) return jsonError('That payment confirmation was not found.', 404)
  if (row.status !== 'submitted') {
    return jsonError(
      row.status === 'pending'
        ? 'Nothing has been uploaded for this month yet.'
        : 'This one has already been reviewed.',
      409
    )
  }

  const { data: updated, error } = await supabase
    .from('payment_confirmations')
    .update({
      status: input.status,
      review_note: input.note,
      verified_by: ctx.userId,
      verified_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'submitted')
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!updated) return jsonError('This one has already been reviewed.', 409)

  const period = `${MONTHS[row.month - 1]} ${row.year}`
  await notifyEmployee(supabase, {
    tenantId: ctx.tenantId,
    employeeId: row.employee_id,
    createdBy: ctx.userId,
    title:
      input.status === 'verified'
        ? `Payment for ${period} confirmed`
        : `Payment confirmation for ${period} needs attention`,
    description:
      input.status === 'verified'
        ? `Your organization has confirmed your ${period} payment record.`
        : `Your ${period} payment confirmation was returned. ${input.note ?? ''}`.trim(),
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `payment.${input.status}`,
    entity: 'payment_confirmations',
    entityId: id,
    meta: { employeeId: row.employee_id, month: row.month, year: row.year },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
