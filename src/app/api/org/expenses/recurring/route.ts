import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { recurringExpenseSchema } from '@/lib/schemas'
import { todayIn } from '@/lib/time'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Create an auto expense — a RULE, not a line.
 *
 * The line this month is owed is booked IMMEDIATELY, by the same idempotent
 * catch-up the expenses page calls (059). It used to be left entirely to the
 * daily job, on the reasoning that "when did this appear in the ledger" should
 * be answerable from the rule alone. In practice that reasoning cost more than
 * it bought: a rule added on the 20th for "the 1st" was visibly active while
 * the month's total ignored it, and since the job runs on an EXTERNAL schedule
 * (004) that may not be set up at all, "on the next run" could mean never.
 *
 * The booked row still carries the rule's own day of the month as `spent_on`,
 * so the ledger reads the same either way; only the waiting is gone.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, recurringExpenseSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('recurring_expenses')
    .insert({
      tenant_id: ctx.tenantId,
      title: input.title,
      description: input.description,
      category: input.category,
      vendor: input.vendor,
      amount: input.amount,
      currency: input.currency,
      day_of_month: input.dayOfMonth,
      start_date: input.startDate,
      end_date: input.endDate ?? null,
      is_active: input.isActive,
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  // Best-effort: the rule is saved either way, and the expenses page runs the
  // same catch-up on load. A failure here delays a line, it does not lose one.
  const { error: catchUpError } = await supabase.rpc('catch_up_recurring_expenses', {
    p_today: todayIn(ctx.tenant.timezone),
  })
  if (catchUpError) {
    console.error('[org/expenses/recurring] catch-up failed', catchUpError)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'expense.recurring.created',
    entity: 'recurring_expenses',
    entityId: data.id,
    meta: { amount: input.amount, currency: input.currency, dayOfMonth: input.dayOfMonth },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
