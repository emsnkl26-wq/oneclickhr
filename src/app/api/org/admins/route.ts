import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { apiRequireOwner } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { inviteAdminSchema } from '@/lib/schemas'
import { generateTempPassword } from '@/lib/crypto'
import { sendEmployeeCredentials, isEmailConfigured } from '@/lib/email'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Invite a second (third, fourth) administrator.
 *
 * OWNER ONLY. An invited admin can do everything else in /org, but not this —
 * see `apiRequireOwner`.
 *
 * The account is created with `app_role: 'org'`, which is the ONE place outside
 * self-signup and the super-admin console that mints an org-role user. That
 * metadata is read by `handle_new_user()` and mirrored into the JWT by the
 * access-token hook (003), so the new admin's very first session already
 * carries org access — there is no second step that could be forgotten.
 *
 * `is_owner` is left FALSE and is not settable from here or from any client
 * path (027's guard trigger refuses it outright). One owner per workspace, and
 * it is whoever created it.
 *
 * ORDER AND ROLLBACK are copied from the employee invite for the same reason it
 * has them: creating an auth user is the irreversible half, so anything that
 * fails after it deletes the user rather than leaving an account nobody can
 * sign into or clean up.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOwner()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const limited = await rateLimit(limitKey('invite-admin', ctx.userId), 10, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have invited several administrators recently. Please try again later.', 429)
  }

  const input = await parseBody(request, inviteAdminSchema)
  const admin = createAdminClient()

  const tempPassword = generateTempPassword()
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
    // TRUSTED metadata. `org` here is the whole difference between this route
    // and the employee invite, and it is why the route is owner-gated.
    app_metadata: {
      app_role: 'org',
      tenant_id: tenantId,
      must_change_password: true,
    },
    user_metadata: { full_name: input.fullName },
  })

  if (createError || !created.user) {
    const message = (createError?.message || '').toLowerCase()
    if (message.includes('already') || message.includes('registered')) {
      return NextResponse.json(
        {
          error: 'Someone already has an account with that email address',
          fields: { email: 'This email is already in use' },
        },
        { status: 409 }
      )
    }
    console.error('[org/admins] createUser failed', createError)
    return jsonError('We could not create that account. Please try again.', 400)
  }

  const userId = created.user.id

  /*
   * `handle_new_user()` has already inserted the profile with the tenant and
   * role taken from the metadata above. This fills in the display name, and a
   * failure here means the account exists but is unusable — so it is undone.
   */
  const { error: profileError } = await admin
    .from('profiles')
    .update({ full_name: input.fullName, email: input.email, is_active: true })
    .eq('id', userId)
    .eq('tenant_id', tenantId)

  if (profileError) {
    try {
      await admin.auth.admin.deleteUser(userId)
    } catch (err) {
      console.error('[org/admins] ROLLBACK FAILED — orphaned auth user', userId, err)
    }
    console.error('[org/admins] profile update failed', profileError.message)
    return jsonError('We could not finish setting up that administrator.', 400)
  }

  let emailSent = false
  if (input.sendCredentialsEmail && isEmailConfigured()) {
    const result = await sendEmployeeCredentials({
      to: input.email,
      fullName: input.fullName,
      tempPassword,
      orgName: ctx.tenant.name,
      // Admins sign in at the ORG door, not the employee one. Sending them to
      // the wrong portal produces a rejected login that looks like a bad
      // password, which is the worst possible first experience.
      adminPortal: true,
    })
    emailSent = result.ok
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'admin.invited',
    entity: 'profiles',
    entityId: userId,
    meta: { email: input.email, emailSent },
    request,
  })

  // Returned ONCE and stored nowhere, exactly like the employee invite: if the
  // email did not go, this is the only copy the owner will ever see.
  return jsonOk({ id: userId, email: input.email, tempPassword, emailSent }, 201)
}

export const POST = withErrorHandler(handlePOST)
