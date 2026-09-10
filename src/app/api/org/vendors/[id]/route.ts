import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { vendorSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, vendorSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('vendors')
    .update({
      name: input.name,
      contact_name: input.contactName,
      email: input.email,
      phone: input.phone,
      address: input.address,
      payment_terms_days: input.paymentTermsDays,
      notes: input.notes,
      status: input.status,
    })
    .eq('id', id)
    .select('id, name')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return jsonError('You already have a vendor with that name.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }
  if (!data) return jsonError('That vendor was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'vendor.updated',
    entity: 'vendors',
    entityId: id,
    meta: { name: data.name },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete a vendor.
 *
 * `employee_assignments_vendor_fk` is ON DELETE RESTRICT, so the database
 * refuses this while anybody is placed with them. That refusal is CAUGHT and
 * turned into advice rather than propagated: deleting a vendor with live
 * placements would orphan the rate behind every invoice we have raised, and
 * "make them inactive instead" is what the person actually wants — an inactive
 * vendor stops appearing in pickers while its history stays intact.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('vendors')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That vendor was not found.', 404)

  const { error } = await supabase.from('vendors').delete().eq('id', id)

  if (error) {
    // 23503 = foreign key violation: somebody is still placed with them.
    if (error.code === '23503') {
      return jsonError(
        'People are still placed with this vendor, so it cannot be deleted. Mark it inactive instead.',
        409
      )
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'vendor.deleted',
    entity: 'vendors',
    entityId: id,
    meta: { name: existing.name },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
