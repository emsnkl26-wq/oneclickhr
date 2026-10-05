import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { withErrorHandler } from '@/lib/api'
import { homeFor } from '@/lib/auth/context'
import { audit } from '@/lib/audit'
import type { UserRole } from '@/types/db'

export const dynamic = 'force-dynamic'

/**
 * Where Google sends someone back to (056).
 *
 * ONE ADDRESS, ONE WAY IN — that is the rule this route exists to enforce:
 *
 *   • An address registered with a PASSWORD cannot be entered through Google.
 *     Supabase quietly links a Google identity onto an existing verified
 *     account with the same address, so "it worked" is not proof of anything:
 *     the identities are inspected, a Google identity that arrived on a
 *     password account is removed again, and the person is told to use their
 *     password.
 *   • An address that signed up through GOOGLE has no password to type; the
 *     password sign-in says so instead of "those details did not match"
 *     (see /api/auth/login).
 *
 * A brand-new Google account has no workspace yet — Google tells us who the
 * person is, not what their company is called — so it is sent to
 * /signup/complete to name one. Only organization accounts come through here;
 * employees and job seekers sign in with the passwords they were given.
 */
async function handleGET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const intent = searchParams.get('intent') === 'signup' ? 'signup' : 'login'
  const door = intent === 'signup' ? '/signup' : '/login'

  const fail = (message: string) =>
    NextResponse.redirect(`${origin}${door}?error=${encodeURIComponent(message)}`)

  // Google reports a cancelled consent screen as ?error=access_denied.
  if (searchParams.get('error') || !code) {
    return fail('Google sign-in was cancelled. You can try again, or use your email and password.')
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) {
    return fail('That Google sign-in has expired. Please try again.')
  }

  const user = data.user
  const providers = new Set((user.identities ?? []).map((identity) => identity.provider))

  // --- A password account reached through Google: refuse, and undo the link --
  if (providers.has('email')) {
    await createAdminClient().rpc('remove_google_identity', { p_user_id: user.id })
    await supabase.auth.signOut()
    await audit({
      actorId: user.id,
      actorEmail: user.email ?? null,
      action: 'auth.google_refused',
      entity: 'auth.users',
      entityId: user.id,
      meta: { reason: 'password_account' },
      request,
    })
    return fail(
      'This email is registered with a password. Sign in with your email and password instead of Google.'
    )
  }

  const { data: rows } = await supabase.rpc('current_profile')
  const profile = (Array.isArray(rows) ? rows[0] : rows) as
    | { role: UserRole; tenant_id: string | null; is_active: boolean; tenant_status: string | null }
    | null
    | undefined

  if (!profile) {
    await supabase.auth.signOut()
    return fail('We could not finish setting up that account. Please try again.')
  }

  // Google is the organization door; nobody else's account is created this way.
  if (profile.role !== 'org' && profile.role !== 'super_admin') {
    await supabase.auth.signOut()
    return fail('Sign in with Google is for organization accounts. Please use your email and password.')
  }

  // --- New account: name the workspace first ---------------------------------
  if (profile.role === 'org' && !profile.tenant_id) {
    return NextResponse.redirect(`${origin}/signup/complete`)
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    return fail('This account has been deactivated. Please contact your administrator.')
  }
  if (profile.role === 'org' && profile.tenant_status === 'suspended') {
    await supabase.auth.signOut()
    return fail('This workspace is suspended. Please contact support.')
  }

  await audit({
    tenantId: profile.tenant_id,
    actorId: user.id,
    actorEmail: user.email ?? null,
    action: 'auth.login',
    entity: 'auth.users',
    entityId: user.id,
    meta: { via: 'google' },
    request,
  })

  return NextResponse.redirect(`${origin}${homeFor(profile.role)}`)
}

export const GET = withErrorHandler(handleGET)
