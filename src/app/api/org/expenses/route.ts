import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { expenseSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Record one expense.
 *
 * Org-only, and enforced by the POLICY rather than by this handler: an employee
 * who reaches here gets a refused insert, not a check somebody could forget to
 * copy into the next route. `apiRequireOrg` is the early, friendly 403.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, expenseSchema)

  // A receipt arrives as a storage KEY, and a key is a path — so it is checked
  // against this tenant's prefix before it is stored. Without this an admin
  // could attach another workspace's file and have /api/files/view resolve it.
  if (input.receiptKey && !keyBelongsToTenant(input.receiptKey, ctx.tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('expenses')
    .insert({
      tenant_id: ctx.tenantId,
      title: input.title,
      description: input.description,
      category: input.category,
      vendor: input.vendor,
      amount: input.amount,
      currency: input.currency,
      spent_on: input.spentOn,
      receipt_url: input.receiptKey,
      source: 'manual',
      created_by: ctx.userId,
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'expense.created',
    entity: 'expenses',
    entityId: data.id,
    meta: { amount: input.amount, currency: input.currency, category: input.category },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
