import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { updateExpenseSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Edit one expense.
 *
 * A row minted by a recurring rule is editable like any other. That is
 * deliberate: the rule says "£45 every month" and reality says the price went
 * up in March, so the March LINE has to be correctable without rewriting
 * history for the other eleven. The rule is edited separately, and only affects
 * what it mints next.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, updateExpenseSchema)

  if (input.receiptKey && !keyBelongsToTenant(input.receiptKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  // Only the keys that were SENT. An absent key leaves its column alone, so two
  // people editing different fields of the same row do not revert each other.
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.description !== undefined) patch.description = input.description
  if (input.category !== undefined) patch.category = input.category
  if (input.vendor !== undefined) patch.vendor = input.vendor
  if (input.amount !== undefined) patch.amount = input.amount
  if (input.currency !== undefined) patch.currency = input.currency
  if (input.spentOn !== undefined) patch.spent_on = input.spentOn
  if (input.receiptKey !== undefined) patch.receipt_url = input.receiptKey

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('expenses')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  // Zero rows means the policy refused it or it does not exist. The two are
  // indistinguishable from here on purpose — and both are a 404 to the caller.
  if (!data) return jsonError('That expense was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'expense.updated',
    entity: 'expenses',
    entityId: id,
    meta: { fields: Object.keys(patch) },
    request,
  })

  return jsonOk({ id })
}

async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That expense was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'expense.deleted',
    entity: 'expenses',
    entityId: id,
    request,
  })

  return jsonOk({ id })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
