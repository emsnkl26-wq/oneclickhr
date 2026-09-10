import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { clientSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, clientSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('clients')
    .update({
      name: input.name,
      contact_name: input.contactName,
      email: input.email,
      address: input.address,
      notes: input.notes,
      status: input.status,
    })
    .eq('id', id)
    .select('id, name')
    .maybeSingle()

  if (error) {
    if (error.code === '23505') {
      return jsonError('You already have a client with that name.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }
  if (!data) return jsonError('That client was not found.', 404)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'client.updated',
    entity: 'clients',
    entityId: id,
    meta: { name: data.name },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete an end client.
 *
 * Unlike a vendor, this succeeds even with live placements: the foreign keys on
 * `employee_assignments` and `timesheets` are ON DELETE SET NULL, so the
 * placements survive and simply stop naming an end client. That is the right
 * asymmetry — losing "which client did they sit with" is a gap in a record,
 * while losing a vendor would orphan the rate behind every invoice raised.
 *
 * The count is reported back so the confirmation can say what it will cost.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That client was not found.', 404)

  const { error } = await supabase.from('clients').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'client.deleted',
    entity: 'clients',
    entityId: id,
    meta: { name: existing.name },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
