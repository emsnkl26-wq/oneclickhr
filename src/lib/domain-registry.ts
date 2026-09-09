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
  /** Proven, versus merely reserved until the deadline in 020. */
  verified: boolean
}

/**
 * The workspace that would collide with `domain`, if there is one.
 *
 * A CLAIM IS ENOUGH TO BLOCK, BUT ONLY UNTIL IT EXPIRES (020).
 *
 * This used to count verified rows only, so that the first stranger to type
 * `acme.com` could not lock the real Acme out of the product forever. The cost
 * of that was the bug it was supposed to prevent: two colleagues signing up on
 * the same domain, each getting their own workspace, nobody noticing until both
 * had data. So an unverified claim now blocks too — and `domain_verify_due_at`
 * is what keeps the original objection answered, because an unproven claim stops
 * blocking anyone once its deadline passes.
 *
 * A past-deadline claim is RELEASED here rather than merely ignored: the unique
 * index in 020 is exact-match and does not know about deadlines, so leaving the
 * row in place would let this function say "free" and the very next INSERT fail
 * with a 23505.
 *
 * "Collide" is wider than "equal", and that width is the point. `acme.com` and
 * `careers.acme.com` are one company; if only exact matches counted, two people
 * from that company could each take one of them and end up with exactly the two
 * disconnected workspaces this feature exists to prevent. So a subdomain of a
 * claimed domain — and a parent of one — both count as taken.
 *
 * THROWS on a database failure rather than returning null, so that each caller
 * chooses its own failure posture. Both of the ones that matter now choose to
 * fail CLOSED: a blip must not be the reason a duplicate workspace exists.
 */
export async function findDomainOwner(
  domain: string,
  exceptTenantId?: string
): Promise<DomainOwner | null> {
  // `normalizeDomain` guarantees this, and the assertion is what lets the
  // PostgREST filter below be built by concatenation: a host that can only
  // contain [a-z0-9.-] cannot carry the commas, parens or quotes that would be
  // needed to break out of the filter grammar.
  if (!/^[a-z0-9.-]+$/.test(domain)) {
    throw new Error('findDomainOwner requires a normalized domain')
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
    .select('id, domain, domain_verified_at, domain_verify_due_at')
    .or(filters.join(','))
    .limit(10)

  if (error) throw error

  const now = Date.now()

  for (const row of data ?? []) {
    if (exceptTenantId && row.id === exceptTenantId) continue
    // Re-checked in TypeScript so the rule lives in ONE readable predicate and
    // the SQL filter is only an index-friendly way of narrowing the candidates.
    if (!row.domain || !domainsConflict(domain, row.domain)) continue

    const verified = row.domain_verified_at != null
    if (verified) return { tenantId: row.id, domain: row.domain, verified: true }

    const due = row.domain_verify_due_at ? new Date(row.domain_verify_due_at).getTime() : null
    // An unproven claim past its deadline is not an owner. Clear it out so the
    // caller's own INSERT does not then hit 020's unique index.
    if (due != null && due < now) {
      const { error: releaseError } = await admin.rpc('release_expired_domain_claim', {
        p_domain: row.domain,
      })
      // A failed release means the row is still there and the caller's write
      // would fail confusingly. Better to report it as taken.
      if (releaseError) {
        return { tenantId: row.id, domain: row.domain, verified: false }
      }
      continue
    }

    return { tenantId: row.id, domain: row.domain, verified: false }
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
  // "Registered" rather than "verified" for a reservation: saying a domain is
  // verified when it is only claimed would be a lie, and the person reading this
  // is about to go and ask a colleague about it.
  const held = owner.verified ? 'is already verified by' : 'is already registered to'
  const advice =
    'If that is your company, ask them to invite you instead of creating a second workspace.'

  return owner.domain === claimed
    ? `${claimed} ${held} another workspace. ${advice}`
    : `${owner.domain} ${held} another workspace, and ${claimed} belongs to it. ${advice}`
}
