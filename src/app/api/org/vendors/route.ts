import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { vendorSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Add a vendor — the company we invoice.
 *
 * Names are unique per workspace (`vendors_name_unique`). That is not tidiness:
 * two rows called "Infosys" means two sets of placements, two sets of invoices,
 * and a revenue report that quietly halves. The 23505 is turned into a sentence
 * rather than surfaced as a database error, because a duplicate name is a
 * perfectly reasonable thing for someone to try.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, vendorSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('vendors')
    .insert({
      tenant_id: ctx.tenantId,
      name: input.name,
      contact_name: input.contactName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      payment_terms_days: input.paymentTermsDays,
      notes: input.notes,
      status: input.status,
      created_by: ctx.userId,
    })
    .select('id, name')
    .single()

  if (error) {
    if (error.code === '23505') {
      return jsonError('You already have a vendor with that name.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'vendor.created',
    entity: 'vendors',
    entityId: data.id,
    meta: { name: data.name },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
