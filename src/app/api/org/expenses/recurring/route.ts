import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { recurringExpenseSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Create an auto expense — a RULE, not a line.
 *
 * Nothing is minted here. The daily job calls `generate_due_expenses()`, which
 * books this month's line if the day has already passed, so a rule added on the
 * 20th for "the 1st" picks the current month up on the next run rather than
 * back-dating one the moment it is saved. That keeps "when did this appear in
 * the ledger" answerable from the rule alone.
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
