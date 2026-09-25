import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { signupSchema } from '@/lib/schemas'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { limitAuthByIp, rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { appUrl } from '@/lib/env'
import { findDomainOwner, ownerConflictMessage } from '@/lib/domain-registry'
import { signupErrorResponse } from '@/lib/signup-errors'

export const dynamic = 'force-dynamic'

/**
 * Has some workspace already taken this website?
 *
 * This is a check-then-write and therefore a race, but it is no longer only
 * cosmetic: since 020 a domain is reserved from the moment it is claimed, so
 * this is the message that tells the second person from a company what actually
 * happened. The enforcement underneath is `tenants_domain_uq` plus the re-check
 * inside the verification handler.
 *
 * Fails CLOSED, which is a reversal. It used to allow the signup through on a
 * lookup error, on the grounds that a database blip must not stop everyone
 * creating an account. That trade no longer pays: with reservations in force,
 * `provision_tenant_for_org()` silently DROPS a contested domain rather than
 * failing, so allowing here does not produce the workspace the person wanted —
 * it produces one with no domain and no explanation. Better to say "try again".
 * And a lookup that cannot reach the database is one the signup INSERT two
 * lines later almost certainly cannot reach either.
 */
class DomainCheckUnavailable extends Error {}

async function takenBy(domain: string) {
  try {
    return await findDomainOwner(domain)
  } catch (err) {
    console.error('[signup] domain availability check failed; refusing', err)
    throw new DomainCheckUnavailable()
  }
}

/**
 * Organization self-signup.
 *
 * The org name and full name go into `raw_user_meta_data`, where the profile
 * trigger reads them as PLAIN DISPLAY STRINGS. Nothing here can influence the
 * account's role or tenant: `handle_new_user()` reads role/tenant exclusively
 * from `raw_app_meta_data`, which only the service role can write. That is what
 * stops a crafted signup payload from minting a super admin — see the trust
 * boundary note in 003_auth_hook_and_triggers.sql.
 *
 * The response is the SAME whether the address is new or already registered.
 * "That email is already in use" is a free account-existence oracle on a public
 * endpoint; Supabase sends the existing account a "someone tried to sign up"
 * notice instead, which is both safer and more useful to the real owner.
 */
async function handlePOST(request: NextRequest) {
  const ipLimit = await limitAuthByIp(request, 'signup')
  if (!ipLimit.ok) {
    return jsonError('Too many sign-up attempts. Please wait a few minutes.', 429)
  }

  const input = await parseBody(request, signupSchema)

  // Per-address limit as well, so one address cannot be used to spray
  // confirmation email at someone.
  const emailLimit = await rateLimit(limitKey('signup-email', input.email), 5, 60 * 60 * 1000)
  if (!emailLimit.ok) {
    return jsonError('Too many sign-up attempts for that address. Please try again later.', 429)
  }

  try {
    const owner = await takenBy(input.domain)
    if (owner) return jsonError(ownerConflictMessage(input.domain, owner), 409)
  } catch (err) {
    if (err instanceof DomainCheckUnavailable) {
      return jsonError('We could not check that website just now. Please try again.', 503)
    }
    throw err
  }

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      // Untrusted display data only. The role is forced to 'org' in the trigger.
      data: {
        org_name: input.orgName,
        // Read back by `provision_tenant_for_org()`, which re-validates the
        // shape before it lands: this is user metadata and therefore untrusted,
        // and an unusable value falls back to one derived from the name.
        org_code: input.orgCode,
        full_name: input.fullName,
        // A CLAIM, not a credential. `provision_tenant_for_org()` copies it onto
        // the new tenant as unverified, re-checking its shape on the way in
        // because everything in this object is caller-controlled.
        org_domain: input.domain,
      },
      // Must match the Supabase "Site URL"/redirect allowlist. The confirmation
      // TEMPLATE is what carries the token_hash link (SETUP.md §4); this is the
      // fallback target Supabase appends to it.
      emailRedirectTo: `${appUrl()}/auth/confirm`,
    },
  })

  if (error) {
    // Real infrastructure failures surface; "already registered" is answered
    // like a success so this endpoint is not an account-existence oracle.
    const failure = signupErrorResponse(error, input.email, 'signup')
    if (failure) return failure
  }

  await audit({
    action: 'auth.signup_requested',
    entity: 'auth.users',
    meta: { org_name: input.orgName, domain: input.domain },
    request,
  })

  return jsonOk({
    message:
      'Check your inbox — we have sent a confirmation link. You can open it on any device.',
  })
}

export const POST = withErrorHandler(handlePOST)
