import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { clientSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Add an END client — where the employee actually sits.
 *
 * Deliberately thinner than a vendor: no phone, no payment terms, because we
 * never invoice a client. The vendor is billed; this exists so "who is this
 * person working for" has one answer with one spelling.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, clientSchema)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('clients')
    .insert({
      tenant_id: ctx.tenantId,
      name: input.name,
      contact_name: input.contactName,
      email: input.email,
      address: input.address,
      notes: input.notes,
      status: input.status,
      created_by: ctx.userId,
    })
    .select('id, name')
    .single()

  if (error) {
    if (error.code === '23505') {
      return jsonError('You already have a client with that name.', 409)
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'client.created',
    entity: 'clients',
    entityId: data.id,
    meta: { name: data.name },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
