import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { apiRequireOwner } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { setDomainSchema } from '@/lib/schemas'
import { findDomainOwner, ownerConflictMessage } from '@/lib/domain-registry'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Set or correct the company website this workspace claims.
 *
 * Written with the ADMIN client, deliberately, even though the caller is an org
 * admin editing their own row: `tg_tenants_guard` (013) refuses every
 * client-session write to the domain columns, because a session that could
 * write `domain_verified_at` could skip verification entirely. So the ONE path
 * that may touch them is a server handler that has already decided the change
 * is allowed — this one — and it scopes itself with `.eq('id', ctx.tenantId)`
 * from the SESSION, never from the request body.
 *
 * Changing the domain always RESETS the proof. A verified `acme.com` that
 * becomes an unverified `other.com` also releases the verified slot for acme.com
 * — which is exactly right if the org rebranded, and harmless if they did not,
 * because they can prove the new one in a minute.
 */
async function handlePATCH(request: NextRequest) {
  // OWNER ONLY (027): the domain is the workspace's identity, and an invited
  // admin who could change it could rename the company out from under it.
  const gate = await apiRequireOwner()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  // Each change is cheap for us but re-points a verification target, so it is
  // bounded to stop the endpoint being used to sweep domains for availability.
  const limit = await rateLimit(limitKey('domain-set', ctx.tenantId), 15, 60 * 60 * 1000)
  if (!limit.ok) {
    return jsonError('Too many changes. Please try again in a little while.', 429)
  }

  const { domain } = await parseBody(request, setDomainSchema)
  const admin = createAdminClient()

  const { data: current, error: readError } = await admin
    .from('tenants')
    .select('domain, domain_verified_at, website')
    .eq('id', ctx.tenantId)
    .single()

  if (readError || !current) {
    console.error('[domain] could not read tenant', readError?.message)
    return jsonError('Something went wrong. Please try again.', 500)
  }

  if (current.domain === domain) {
    return jsonOk({ domain, verified: !!current.domain_verified_at, unchanged: true })
  }

  // Same rule as signup: any live claim elsewhere blocks this one, proven or
  // merely reserved (020) — and "elsewhere" includes a parent or a subdomain,
  // because `acme.com` and `careers.acme.com` are one company.
  const owner = await findDomainOwner(domain, ctx.tenantId)
  if (owner) return jsonError(ownerConflictMessage(domain, owner), 409)

  const { error } = await admin
    .from('tenants')
    .update({
      domain,
      domain_verified_at: null,
      domain_verification_method: null,
      // A new claim starts its own reservation window. Without this a workspace
      // that switched domains late would inherit the old deadline and could be
      // out of time before it ever saw the banner.
      domain_verify_due_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      // Keep the letterhead's display website in step, but only while it was
      // still whatever we seeded — never overwrite something they typed.
      ...(!current.website || current.website === current.domain ? { website: domain } : {}),
    })
    .eq('id', ctx.tenantId)

  if (error) {
    // 020's unique index, reached by the race the check above cannot close:
    // somebody claimed the same domain between the lookup and this write.
    if (error.code === '23505') {
      return jsonError(
        'That website was registered by another workspace a moment ago. If that is your ' +
          'company, ask them to invite you instead of creating a second workspace.',
        409
      )
    }
    console.error('[domain] update failed', error.message)
    return jsonError('We could not save that website. Please try again.', 400)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'tenant.domain_set',
    entity: 'tenants',
    entityId: ctx.tenantId,
    meta: { from: current.domain, to: domain, was_verified: !!current.domain_verified_at },
    request,
  })

  return jsonOk({ domain, verified: false })
}

export const PATCH = withErrorHandler(handlePATCH)
