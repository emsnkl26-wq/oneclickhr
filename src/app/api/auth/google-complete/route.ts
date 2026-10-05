import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { signupSchema } from '@/lib/schemas'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { resolveContext } from '@/lib/auth/context'
import { audit } from '@/lib/audit'
import { findDomainOwner, ownerConflictMessage } from '@/lib/domain-registry'

export const dynamic = 'force-dynamic'

const completeSchema = signupSchema.pick({ orgName: true, orgCode: true, fullName: true, domain: true })

/**
 * Create the workspace for a Google sign-up (056).
 *
 * The same four answers an email sign-up gives, and the same rules: the
 * website must not already belong to another workspace, and the workspace is
 * built in the database by `provision_tenant_for_existing_org()` from the
 * user's metadata — the same place an email sign-up's details travel through.
 *
 * Then the session is REFRESHED. The tenant and role live in the JWT's claims,
 * and the token this person holds was minted before their workspace existed;
 * without a new one every policy would still see a user with no tenant.
 */
async function handlePOST(request: NextRequest) {
  // Not apiRequireUser(): that refuses any non-platform account without an
  // active tenant, and having no tenant yet is exactly this caller's state.
  const result = await resolveContext()
  if (result.status !== 'ok') return jsonError('Not authenticated', 401)
  const { ctx } = result
  if (!ctx.isActive) return jsonError('This account is no longer active', 403)

  if (ctx.role !== 'org') return jsonError('Only an organization account can create a workspace.', 403)
  if (ctx.tenantId) return jsonOk({ redirectTo: '/org' })

  const input = await parseBody(request, completeSchema)

  try {
    const owner = await findDomainOwner(input.domain)
    if (owner) return jsonError(ownerConflictMessage(input.domain, owner), 409)
  } catch (err) {
    console.error('[google-complete] domain check failed', err)
    return jsonError('We could not check that website just now. Please try again.', 503)
  }

  const admin = createAdminClient()
  const { data: existing } = await admin.auth.admin.getUserById(ctx.userId)
  const { error: metaError } = await admin.auth.admin.updateUserById(ctx.userId, {
    user_metadata: {
      ...(existing?.user?.user_metadata ?? {}),
      org_name: input.orgName,
      org_code: input.orgCode,
      org_domain: input.domain,
      full_name: input.fullName,
    },
  })
  if (metaError) {
    console.error('[google-complete] metadata update failed', metaError.message)
    return jsonError('Something went wrong. Please try again.', 500)
  }

  // The name typed here wins over whatever Google called them.
  await admin.from('profiles').update({ full_name: input.fullName }).eq('id', ctx.userId)

  const { data: tenantId, error } = await admin.rpc('provision_tenant_for_existing_org', {
    p_user_id: ctx.userId,
  })
  if (error || !tenantId) {
    console.error('[google-complete] provisioning failed', error?.message)
    return jsonError('We could not create the workspace. Please try again.', 500)
  }

  const supabase = await createSupabaseServerClient()
  await supabase.auth.refreshSession()

  await audit({
    tenantId: tenantId as string,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'auth.signup_completed',
    entity: 'tenants',
    entityId: tenantId as string,
    meta: { via: 'google', org_name: input.orgName, domain: input.domain },
    request,
  })

  return jsonOk({ redirectTo: '/org' })
}

export const POST = withErrorHandler(handlePOST)
