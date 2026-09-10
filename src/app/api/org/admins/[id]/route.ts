import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, uuidSchema } from '@/lib/api'
import { apiRequireOwner } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Revoke an administrator.
 *
 * OWNER ONLY, and it cannot touch the owner — two checks, because they fail for
 * different reasons and deserve different sentences. Without the second, an
 * owner could revoke themselves and leave a workspace with no administrator at
 * all, which nothing in the product could then undo.
 *
 * WHAT "REVOKE" MEANS HERE: the account is DEACTIVATED, not deleted. Their name
 * is on approvals, audit rows and generated documents; deleting the profile
 * would either cascade those away or leave them pointing at nothing. `is_active`
 * is re-read from the database on every single request (see the note in
 * src/lib/auth/context.ts), so access ends on their very next click rather than
 * whenever their token happens to expire.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOwner()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const id = uuidSchema.parse((await params).id)

  if (id === ctx.userId) {
    return jsonError('You cannot revoke your own access as the workspace owner.', 400)
  }

  const admin = createAdminClient()

  const { data: target } = await admin
    .from('profiles')
    .select('id, email, full_name, role, is_owner')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!target) return jsonError('That administrator was not found.', 404)
  if (target.is_owner) {
    return jsonError('The workspace owner cannot be revoked.', 400)
  }
  if (target.role !== 'org') {
    return jsonError('That account is not an administrator.', 400)
  }

  const { error } = await admin
    .from('profiles')
    .update({ is_active: false })
    .eq('id', id)
    .eq('tenant_id', tenantId)

  if (error) {
    console.error('[org/admins] revoke failed', error.message)
    return jsonError('We could not revoke that administrator. Please try again.', 400)
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'admin.revoked',
    entity: 'profiles',
    entityId: id,
    meta: { email: target.email },
    request,
  })

  return jsonOk({ ok: true })
}

export const DELETE = withErrorHandler(handleDELETE)
