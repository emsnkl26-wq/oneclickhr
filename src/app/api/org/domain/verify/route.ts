import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, limitKey, getClientIp } from '@/lib/rate-limit'
import { verifyDomainOwnership } from '@/lib/domain-verify'
import { findVerifiedOwner, ownerConflictMessage } from '@/lib/domain-registry'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'
/**
 * Four candidate URLs plus DNS, on a 14s internal budget. The platform default
 * of 10s would cut a slow-but-real site off mid-check and report "unreachable"
 * about a site that is up.
 *
 * Mirrored in `vercel.json`, which is where this project has always configured
 * function duration; the export is what makes it hold anywhere else.
 */
export const maxDuration = 30

/**
 * "Check my website now."
 *
 * The endpoint makes an OUTBOUND REQUEST TO AN ADDRESS THE CALLER CHOSE, which
 * is the one genuinely sensitive thing in this feature. Three things contain it:
 *
 *   • The target is not in the request body. It is read from the caller's own
 *     tenant row, so the only domains anyone can point this at are ones their
 *     workspace already claims through the validated PATCH above.
 *   • `verifyDomainOwnership` refuses every private, loopback, link-local and
 *     otherwise reserved address, at DNS-lookup time, on every redirect hop.
 *   • It is rate limited per workspace AND per IP, so it cannot be turned into
 *     a scanner or an amplifier even by someone with a valid account.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  // Generous enough for "I just deployed, let me retry" and far too small to
  // probe anything with. Both limits must pass.
  const perTenant = await rateLimit(limitKey('domain-verify', ctx.tenantId), 12, 10 * 60 * 1000)
  if (!perTenant.ok) {
    return jsonError(
      'Too many verification attempts. Please wait a few minutes and try again.',
      429
    )
  }
  const perIp = await rateLimit(limitKey('domain-verify-ip', getClientIp(request)), 30, 10 * 60 * 1000)
  if (!perIp.ok) {
    return jsonError('Too many requests. Please wait a few minutes and try again.', 429)
  }

  const admin = createAdminClient()

  const { data: tenant, error: readError } = await admin
    .from('tenants')
    .select('domain, domain_token, domain_verified_at')
    .eq('id', ctx.tenantId)
    .single()

  if (readError || !tenant) {
    console.error('[domain-verify] could not read tenant', readError?.message)
    return jsonError('Something went wrong. Please try again.', 500)
  }

  if (!tenant.domain) {
    return jsonError('Add your company website before verifying it.', 400)
  }
  if (tenant.domain_verified_at) {
    return jsonOk({ ok: true, alreadyVerified: true, domain: tenant.domain })
  }

  /*
   * Is this website still free? The claim was checked when it was set, but that
   * could have been days ago and the other workspace may have proven it since.
   *
   * NOT caught, unlike the advisory check at signup. This one FAILS CLOSED: a
   * verification written without it is a duplicate somebody unpicks by hand
   * later, which is exactly the mess this feature exists to prevent, so a
   * database blip must surface as a 500 the org can retry rather than as a
   * wrong "verified".
   *
   * Asked here, before the network call, purely so an org that cannot win does
   * not wait fourteen seconds to be told. The check that actually decides is
   * the second one, below.
   */
  const owner = await findVerifiedOwner(tenant.domain, ctx.tenantId)
  if (owner) return jsonError(ownerConflictMessage(tenant.domain, owner), 409)

  const result = await verifyDomainOwnership(tenant.domain, tenant.domain_token)

  if (!result.ok) {
    await audit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'tenant.domain_verification_failed',
      entity: 'tenants',
      entityId: ctx.tenantId,
      meta: { domain: tenant.domain, reason: result.reason },
      request,
    })

    return jsonError(failureMessage(result.reason, tenant.domain, result.checkedUrl), 422)
  }

  /*
   * The last word, taken as late as possible.
   *
   * The network call above can take fourteen seconds, which is fourteen seconds
   * in which another workspace could have verified. Asking again here shrinks
   * that window to the milliseconds between this query and the update below.
   *
   * It is not redundant with the index. `tenants_verified_domain_uq` makes an
   * EXACT collision impossible — two workspaces cannot both hold `acme.com`,
   * whatever the timing. What the index cannot see is the SUBDOMAIN case:
   * `acme.com` and `careers.acme.com` are two different strings to Postgres and
   * one company to us, so that rule can only be enforced by this read. The
   * residual race — two workspaces proving a domain and its subdomain within
   * the same few milliseconds — is left standing knowingly: closing it needs a
   * lock on every verification, and the outcome is visible in the platform
   * console, where the organization list shows each workspace's domain.
   */
  const lateOwner = await findVerifiedOwner(tenant.domain, ctx.tenantId)
  if (lateOwner) return jsonError(ownerConflictMessage(tenant.domain, lateOwner), 409)

  const { error: writeError } = await admin
    .from('tenants')
    .update({
      domain_verified_at: new Date().toISOString(),
      domain_verification_method: result.method,
    })
    .eq('id', ctx.tenantId)
    // Belt and braces: never stamp a verification onto a row whose domain moved
    // while we were out on the network.
    .eq('domain', tenant.domain)

  if (writeError) {
    if (writeError.code === '23505') {
      return jsonError(
        `${tenant.domain} was just verified by another workspace. If that is your ` +
          'company, ask them to invite you rather than creating a second workspace.',
        409
      )
    }
    console.error('[domain-verify] write failed', writeError.code, writeError.message)
    return jsonError('We confirmed your website but could not save it. Please try again.', 500)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'tenant.domain_verified',
    entity: 'tenants',
    entityId: ctx.tenantId,
    meta: { domain: tenant.domain, method: result.method },
    request,
  })

  return jsonOk({ ok: true, domain: tenant.domain, method: result.method })
}

/**
 * The failure text, and it is worth the care.
 *
 * "Verification failed" sends someone back to re-read instructions they already
 * followed. Each of these names what we actually observed and the one next move
 * that fixes it — the difference between a support ticket and a second attempt.
 */
function failureMessage(
  reason: 'tag_missing' | 'unreachable' | 'blocked',
  domain: string,
  checkedUrl: string | null
): string {
  const where = checkedUrl ?? `https://${domain}`
  switch (reason) {
    case 'tag_missing':
      return (
        `We loaded ${where} but did not find your verification tag on it. If you just ` +
        'published the change, give it a minute for your site to rebuild and try again — ' +
        'and check the tag is on the homepage itself, inside <head>.'
      )
    case 'blocked':
      return (
        `${domain} does not resolve to a public web address, so we cannot reach it from ` +
        'the internet. Check the website address is the one your customers use.'
      )
    default:
      return (
        `We could not reach ${where} over HTTPS. Check that the address is spelled ` +
        'correctly and that the site is live with a valid certificate. If your site ' +
        'has no HTTPS, use the DNS record option below instead.'
      )
  }
}

export const POST = withErrorHandler(handlePOST)
