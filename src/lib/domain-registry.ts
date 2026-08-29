import 'server-only'

/**
 * "Does another workspace already own this website?" — asked in three places
 * (signup, changing the claim, and the moment before a verification is stamped)
 * and therefore answered in one.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { domainsConflict, parentDomains } from '@/lib/domain'

export interface DomainOwner {
  tenantId: string
  domain: string
}

/**
 * The verified workspace that would collide with `domain`, if there is one.
 *
 * ONLY VERIFIED ROWS COUNT. An unproven claim blocks nothing — otherwise the
 * first stranger to type `acme.com` locks the real Acme out of the product
 * permanently, and a duplicate-prevention feature becomes a denial of service.
 *
 * "Collide" is wider than "equal", and that width is the point. `acme.com` and
 * `careers.acme.com` are one company; if only exact matches counted, two people
 * from that company could each verify one of them and end up with exactly the
 * two disconnected workspaces this feature exists to prevent. So a subdomain of
 * a verified domain — and a parent of one — both count as taken.
 *
 * THROWS on a database failure rather than returning null. The callers have
 * genuinely different needs: signup treats a failure as "allow" (a blip must
 * not stop everyone creating an account), while verification must treat it as
 * "stop" (a verification stamped without this check is a duplicate we then have
 * to unpick by hand). Swallowing the error here would take that choice away
 * from both of them.
 */
export async function findVerifiedOwner(
  domain: string,
  exceptTenantId?: string
): Promise<DomainOwner | null> {
  // `normalizeDomain` guarantees this, and the assertion is what lets the
  // PostgREST filter below be built by concatenation: a host that can only
  // contain [a-z0-9.-] cannot carry the commas, parens or quotes that would be
  // needed to break out of the filter grammar.
  if (!/^[a-z0-9.-]+$/.test(domain)) {
    throw new Error('findVerifiedOwner requires a normalized domain')
  }

  const parents = parentDomains(domain)
  const filters = [
    `domain.eq.${domain}`,
    // Subdomains of the claim: someone verified `careers.acme.com`, we want
    // `acme.com`. `*` is PostgREST's wildcard in a `like` filter.
    `domain.like.*.${domain}`,
    // Parents of the claim: someone verified `acme.com`, we want
    // `careers.acme.com`. Bounded by label count, so it is a short IN list.
    ...(parents.length > 0 ? [`domain.in.(${parents.join(',')})`] : []),
  ]

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('tenants')
    .select('id, domain')
    .not('domain_verified_at', 'is', null)
    .or(filters.join(','))
    .limit(10)

  if (error) throw error

  for (const row of data ?? []) {
    if (exceptTenantId && row.id === exceptTenantId) continue
    // Re-checked in TypeScript so the rule lives in ONE readable predicate and
    // the SQL filter is only an index-friendly way of narrowing the candidates.
    if (row.domain && domainsConflict(domain, row.domain)) {
      return { tenantId: row.id, domain: row.domain }
    }
  }
  return null
}

/**
 * The sentence a person reads when their website is already taken.
 *
 * Names the domain that actually collided, which is the whole difference between
 * a message someone can act on and one that reads as a bug: told "acme.com is
 * taken" while typing `careers.acme.com`, they go and find the colleague who
 * set it up. Told "already registered", they open a support ticket.
 */
export function ownerConflictMessage(claimed: string, owner: DomainOwner): string {
  const same = owner.domain === claimed
  return same
    ? `${claimed} is already verified by another workspace. If that is your company, ` +
        'ask them to invite you instead of creating a second workspace.'
    : `${owner.domain} is already verified by another workspace, and ${claimed} belongs ` +
        'to it. If that is your company, ask them to invite you instead of creating a ' +
        'second workspace.'
}
