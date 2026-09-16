import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { updateRecurringExpenseSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Edit an auto expense.
 *
 * FORWARD-LOOKING ONLY. Changing the amount changes what is minted from now on
 * and leaves every line already booked exactly as it was — those are payments
 * that actually happened, and rewriting them to match a new price would make
 * last quarter's numbers change under someone who had already read them.
 * Pausing (`isActive: false`) is the same story: it stops the next one.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, updateRecurringExpenseSchema)

  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.category !== undefined) patch.category = input.category
  if (input.vendor !== undefined) patch.vendor = input.vendor
  if (input.amount !== undefined) patch.amount = input.amount
  if (input.currency !== undefined) patch.currency = input.currency
  if (input.dayOfMonth !== undefined) patch.day_of_month = input.dayOfMonth
  if (input.startDate !== undefined) patch.start_date = input.startDate
  if (input.endDate !== undefined) patch.end_date = input.endDate
  if (input.isActive !== undefined) patch.is_active = input.isActive

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('recurring_expenses')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That auto expense was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'expense.recurring.updated',
    entity: 'recurring_expenses',
    entityId: id,
    meta: { fields: Object.keys(patch) },
    request,
  })

  return jsonOk({ id })
}

/**
 * Delete the rule. The lines it already booked STAY — the foreign key is
 * `on delete set null` precisely so that deleting "Figma subscription" does not
 * erase the eleven payments made under it. A ledger you can edit by deleting
 * the thing that explains it is not a ledger.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('recurring_expenses')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That auto expense was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'expense.recurring.deleted',
    entity: 'recurring_expenses',
    entityId: id,
    request,
  })

  return jsonOk({ id })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
