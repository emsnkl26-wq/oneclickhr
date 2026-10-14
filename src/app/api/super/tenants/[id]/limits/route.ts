import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { tenantLimitsSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * The manual lever behind both of 061's limits — "contact us and we will sort
 * it out" made into an endpoint.
 *
 * Three things one workspace at a time:
 *
 *   • raise (or lower) its employee seat limit;
 *   • give it more time to verify its company website, which un-pauses it
 *     immediately if the deadline had already passed;
 *   • mark that website verified, for the org that proved it to support by
 *     some route the automated check cannot see.
 *
 * ADMIN CLIENT, like every other write in /super: the super admin's RLS bypass
 * is read-only by design (see the sibling route's header), and all three of
 * these columns are additionally refused to any session by `tg_tenants_guard`.
 * The service role behind `requireSuperAdmin()` is the only path, which is the
 * property that makes the limits limits.
 *
 * EVERY CHANGE IS AUDITED AGAINST THE TENANT, so the workspace's own audit view
 * shows who gave them the extra seats and when.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const tenantId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, tenantLimitsSchema)

  const admin = createAdminClient()

  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, domain, domain_verified_at, domain_verify_due_at, employee_limit')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) return jsonError('That organization was not found.', 404)

  const patch: Record<string, unknown> = {}
  const changes: Record<string, unknown> = {}

  if (input.employeeLimit !== undefined && input.employeeLimit !== tenant.employee_limit) {
    patch.employee_limit = input.employeeLimit
    changes.employee_limit = { from: tenant.employee_limit, to: input.employeeLimit }
  }

  if (input.domainGraceDays !== undefined) {
    const dueAt = new Date(Date.now() + input.domainGraceDays * 86_400_000).toISOString()
    patch.domain_verify_due_at = dueAt
    changes.domain_verify_due_at = { from: tenant.domain_verify_due_at, to: dueAt }
  }

  if (input.domainVerified) {
    if (!tenant.domain) {
      return jsonError(
        'This workspace has not claimed a website yet, so there is nothing to mark verified.',
        400
      )
    }
    if (!tenant.domain_verified_at) {
      patch.domain_verified_at = new Date().toISOString()
      // Recorded as a meta verification rather than a fourth method: it is the
      // same proof, accepted by a person instead of by the checker.
      patch.domain_verification_method = 'meta'
      changes.domain_verified = tenant.domain
    }
  }

  if (!Object.keys(patch).length) return jsonOk({ ok: true, unchanged: true })

  const { error } = await admin.from('tenants').update(patch).eq('id', tenantId)
  if (error) {
    // 013's partial unique index: somebody else has already PROVEN this domain.
    // Only reachable on the manual-verify path, and the right answer is to look
    // at the other workspace rather than to force it through.
    if (error.code === '23505') {
      return jsonError(
        `Another workspace has already verified ${tenant.domain}. Check which one is the real ` +
          'company before verifying this one.',
        409
      )
    }
    return jsonError(friendlyDbError(error), 400)
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'tenant.limits_changed',
    entity: 'tenants',
    entityId: tenantId,
    meta: { name: tenant.name, ...changes, reason: input.reason },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
