import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loginSchema } from '@/lib/schemas'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import {
  limitAuthByIp, isLoginLocked, recordLoginFailure, clearLoginFailures, LOCKOUT,
} from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { homeFor } from '@/lib/auth/context'

export const dynamic = 'force-dynamic'

/**
 * Sign in.
 *
 * Runs on the server rather than calling `signInWithPassword` from the browser,
 * because the throttling and lockout below only mean something if the client
 * cannot skip them.
 *
 * ENUMERATION SAFETY is the design constraint throughout:
 *   • The lockout counter is keyed on a hash of the submitted address and is
 *     incremented for UNKNOWN addresses too. If only real accounts could lock
 *     out, the lockout itself would answer "is this person registered?".
 *   • Every failure returns the same message and the same status, whether the
 *     account is missing, the password is wrong, or the email is unconfirmed.
 *     The one exception is a LOCKED account, which has to say so or the user
 *     cannot understand why a correct password is failing — and by then the
 *     attacker has already had to spend ten guesses on that address.
 */
async function handlePOST(request: NextRequest) {
  // Per-IP first, before any lookup, so timing reveals nothing.
  const ipLimit = await limitAuthByIp(request, 'login')
  if (!ipLimit.ok) {
    return jsonError('Too many sign-in attempts. Please wait a few minutes.', 429)
  }

  const { email, password, portal } = await parseBody(request, loginSchema)

  if (await isLoginLocked(email)) {
    return jsonError(
      `Too many failed attempts. Sign-in for this address is paused for ${Math.round(
        LOCKOUT.windowMs / 60000
      )} minutes.`,
      429
    )
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    await recordLoginFailure(email)
    await audit({
      action: 'auth.login_failed',
      entity: 'auth.users',
      meta: { reason: error?.message ?? 'unknown' },
      request,
    })
    // Deliberately identical for every failure mode.
    return jsonError('Those details did not match. Please check and try again.', 401)
  }

  // NOT cleared yet. The counter is reset only once the sign-in has fully
  // succeeded, so hammering one portal with the other's credentials still spends
  // the lockout budget instead of resetting it on every attempt.

  // Resolve the landing route from the profile, not from the request.
  const { data: profileRows, error: profileError } = await supabase.rpc('current_profile')
  const profile = Array.isArray(profileRows) ? profileRows[0] : profileRows

  // FAIL CLOSED. Every check below is written `profile.x`, so a missing profile
  // used to skip all of them and hand out a default `employee` landing route —
  // credentials verified, authorization never evaluated. Refuse the session
  // instead, and drop the cookie so the browser is not left half signed-in.
  if (profileError || !profile) {
    console.error('[auth] login: no profile for', data.user.id, profileError?.message)
    await supabase.auth.signOut()
    return jsonError(
      'This account is not fully set up yet. Please contact your administrator.',
      403
    )
  }

  // --- The portal the request came from must match the account's role -------
  // Same message and same status as a wrong password, on purpose: "correct
  // password, wrong door" would otherwise tell an attacker both that the address
  // is registered AND which kind of account it is. The failure is also recorded
  // like any other, so probing one door with the other's credentials still
  // spends the lockout budget.
  const allowedRoles =
    portal === 'employee'
      ? ['employee']
      : portal === 'candidate'
        ? ['candidate']
        : ['org', 'super_admin']
  if (!allowedRoles.includes(profile.role)) {
    await supabase.auth.signOut()
    await recordLoginFailure(email)
    await audit({
      actorId: data.user.id,
      action: 'auth.login_failed',
      entity: 'auth.users',
      meta: { reason: 'wrong_portal', portal },
      request,
    })
    return jsonError('Those details did not match. Please check and try again.', 401)
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    return jsonError('This account has been deactivated. Please contact your administrator.', 403)
  }
  if (
    profile.role !== 'super_admin' &&
    profile.role !== 'candidate' &&
    profile.tenant_status === 'suspended'
  ) {
    await supabase.auth.signOut()
    return jsonError('This workspace is suspended. Please contact support.', 403)
  }

  await clearLoginFailures(email)

  await audit({
    tenantId: profile.tenant_id ?? null,
    actorId: data.user.id,
    actorEmail: data.user.email ?? null,
    action: 'auth.login',
    entity: 'auth.users',
    entityId: data.user.id,
    request,
  })

  const redirectTo = profile.must_change_password
    ? '/change-password'
    : homeFor(profile.role)

  return jsonOk({ redirectTo })
}

export const POST = withErrorHandler(handlePOST)
