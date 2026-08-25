import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { generateTempPassword } from '@/lib/crypto'
import { sendEmployeeCredentials, isEmailConfigured } from '@/lib/email'
import { EMPLOYEE_LOGIN_PATH } from '@/lib/routes'
import { appUrl } from '@/lib/env'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Issue a fresh temporary password for an employee and return it ONCE.
 *
 * The original temp password is never stored — only its hash reaches the auth
 * schema — so "show me the credentials again" is impossible by construction.
 * Minting a new one is the honest equivalent: the org gets something it can
 * hand over, and the previous password stops working immediately.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const employeeId = uuidSchema.parse((await params).id)

  const supabase = await createSupabaseServerClient()
  // RLS scopes the lookup, so an id from another workspace is simply a 404.
  const { data: employee } = await supabase
    .from('profiles')
    .select('id, role, email, full_name, is_active')
    .eq('id', employeeId)
    .maybeSingle()

  if (!employee) return jsonError('That employee was not found.', 404)
  if (employee.role !== 'employee') {
    return jsonError('Only employee accounts have portal sign-in details.', 400)
  }
  if (!employee.is_active) {
    return jsonError('Reactivate this employee before issuing a new password.', 400)
  }
  if (!employee.email) {
    return jsonError('This employee has no email address to sign in with.', 400)
  }

  const tempPassword = generateTempPassword()
  const admin = createAdminClient()

  const { error: authError } = await admin.auth.admin.updateUserById(employeeId, {
    password: tempPassword,
  })
  if (authError) {
    return jsonError('Could not set a new password. Please try again.', 400)
  }

  // Force the reset-on-first-login flow again, so this password is single-use
  // in practice exactly like the one issued at onboarding.
  const { error: flagError } = await supabase
    .from('profiles')
    .update({ must_change_password: true })
    .eq('id', employeeId)
  if (flagError) {
    console.error('[credentials] could not set must_change_password', flagError.message)
  }

  /*
   * Their old sessions were signed in against the previous password. Revoking
   * them avoids the state where a still-valid token skips the forced reset.
   */
  try {
    await admin.auth.admin.signOut(employeeId, 'global')
  } catch (err) {
    console.warn('[credentials] could not revoke sessions', err)
  }

  // Emailing it is the default; the caller opts out with { email: false }.
  const body = (await request.json().catch(() => ({}))) as { email?: boolean }
  const sendEmail = body.email !== false
  let emailSent = false
  if (sendEmail && isEmailConfigured()) {
    const result = await sendEmployeeCredentials({
      to: employee.email,
      fullName: employee.full_name ?? '',
      tempPassword,
      orgName: ctx.tenant.name,
      brandColor: ctx.tenant.primaryColor,
    })
    emailSent = result.ok
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'employee.password_reset',
    entity: 'profiles',
    entityId: employeeId,
    meta: { email: employee.email, emailSent },
    request,
  })

  return jsonOk({
    email: employee.email,
    tempPassword,
    emailSent,
    loginUrl: `${appUrl()}${EMPLOYEE_LOGIN_PATH}`,
  })
}

export const POST = withErrorHandler(handlePOST)
