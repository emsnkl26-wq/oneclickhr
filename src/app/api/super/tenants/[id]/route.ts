import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteTenantSchema, tenantStatusSchema } from '@/lib/schemas'
import { verifyOwnPassword } from '@/lib/auth/reauth'
import { purgeOrganization } from '@/lib/platform-delete'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Suspend or reactivate an organization.
 *
 * WHY THIS USES THE ADMIN CLIENT: the super admin's RLS bypass is READ-ONLY by
 * design (only SELECT policies mention `app.is_super_admin()`), so there is no
 * policy under which they can UPDATE a tenant. Writing through the service role,
 * behind `requireSuperAdmin()`, keeps that property intact — the read-only rule
 * is not weakened just to make one button work.
 *
 * Suspension bites IMMEDIATELY and for everyone in that workspace:
 * `app.is_active_member()` joins tenants and requires `status = 'active'`, and
 * it is evaluated live on every policy check. Nobody waits for a token to expire.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const tenantId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, tenantStatusSchema)

  const admin = createAdminClient()

  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, status')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) return jsonError('That organization was not found.', 404)
  if (tenant.status === input.status) {
    return jsonOk({ ok: true, unchanged: true })
  }

  const { error } = await admin
    .from('tenants')
    .update({ status: input.status })
    .eq('id', tenantId)

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    // A platform-level action against a specific tenant: recorded against that
    // tenant so its own audit view shows it too.
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: input.status === 'suspended' ? 'tenant.suspended' : 'tenant.reactivated',
    entity: 'tenants',
    entityId: tenantId,
    meta: { name: tenant.name, reason: input.reason },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * PERMANENTLY delete an organization and everything in it (053).
 *
 * Four independent checks, because this cannot be undone:
 *
 *   1. The workspace must ALREADY be suspended. Suspending is instant and
 *      reversible; making it a separate earlier step means nobody deletes a
 *      live workspace by mis-clicking, and everyone in it has already been
 *      locked out before their data goes.
 *   2. The organization's exact name, typed.
 *   3. The word DELETE, typed.
 *   4. The operator's own password, re-checked now (verifyOwnPassword).
 *
 * The audit entry is written with NO tenant id — the tenant row is about to
 * stop existing, and the entry has to outlive it.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const tenantId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, deleteTenantSchema)

  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, slug, status, domain')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) return jsonError('That organization was not found.', 404)
  if (tenant.status !== 'suspended') {
    return jsonError('Suspend the organization first. Deletion is only possible once it is suspended.', 409)
  }
  if (input.confirmName.trim() !== String(tenant.name).trim()) {
    return jsonError('The name you typed does not match this organization.', 400)
  }

  const reauth = await verifyOwnPassword(ctx.userId, ctx.email, input.password)
  if (!reauth.ok) return jsonError(reauth.error, reauth.status)

  // Recorded BEFORE the purge as well as after: if the run dies half way, the
  // log still says who started it and why.
  await audit({
    tenantId: null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'tenant.delete_started',
    entity: 'tenants',
    entityId: tenantId,
    meta: { name: tenant.name, slug: tenant.slug, domain: tenant.domain, reason: input.reason },
    request,
  })

  const result = await purgeOrganization(tenantId)

  await audit({
    tenantId: null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: result.ok ? 'tenant.deleted' : 'tenant.delete_failed',
    entity: 'tenants',
    entityId: tenantId,
    meta: {
      name: tenant.name,
      accountsRemoved: result.accountsRemoved,
      ...(result.ok ? { filesRemoved: result.filesRemoved } : { error: result.error }),
    },
    request,
  })

  if (!result.ok) return jsonError(result.error, result.status)
  return jsonOk({ ok: true, accountsRemoved: result.accountsRemoved })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
