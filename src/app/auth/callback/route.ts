import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { withErrorHandler } from '@/lib/api'
import { homeFor } from '@/lib/auth/context'
import { audit } from '@/lib/audit'
import type { UserRole } from '@/types/db'

export const dynamic = 'force-dynamic'

/** Which door the person came through. Decides who is allowed back out. */
type Intent = 'login' | 'signup' | 'employee' | 'candidate' | 'candidate-signup'

/** Where a refusal is shown: the page the person actually started on. */
const DOOR: Record<Intent, string> = {
  login: '/login',
  signup: '/signup',
  employee: '/employee-login',
  candidate: '/jobs/login',
  'candidate-signup': '/jobs/signup',
}

const INTENTS = Object.keys(DOOR) as Intent[]

function readIntent(raw: string | null): Intent {
  return INTENTS.includes(raw as Intent) ? (raw as Intent) : 'login'
}

/**
 * The job seeker door, from either of its two pages.
 *
 * Signing in and signing up are the same act here — Google has already proved
 * who the person is, so an account either exists for that address or is created
 * — and the two intents differ only in wording and in which page an error
 * lands on. Treating them as one everywhere below is what keeps that true.
 */
const isCandidateDoor = (intent: Intent) =>
  intent === 'candidate' || intent === 'candidate-signup'

/**
 * A Google account that has only just been created by this very exchange.
 *
 * Google tells us who someone is, not whether they belong anywhere, so an
 * address nobody has provisioned still produces a usable auth user. On the
 * employee and job seeker doors that user is a stray, but it is only safe to
 * treat it as one when it really is brand new — an org account that stopped
 * half way through /signup/complete looks identical by role alone, and
 * sweeping that up would destroy a real signup.
 */
function isFreshlyCreated(createdAt: string | undefined): boolean {
  if (!createdAt) return false
  const age = Date.now() - new Date(createdAt).getTime()
  return Number.isFinite(age) && age >= 0 && age < 120_000
}

/**
 * Where Google sends someone back to (056).
 *
 * ONE ADDRESS, ONE WAY IN — on the ORGANIZATION door, that is still the rule:
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
 * The EMPLOYEE and JOB SEEKER doors are deliberately different. An employee is
 * given an email and a password by their organization, and may then sign in
 * with either those details or Google on that same address — so a Google
 * identity landing on their password account is the feature, not an attack.
 * What an employee cannot do is arrive from an address no organization has ever
 * added: there is nothing for them to sign in to, and the message says exactly
 * that instead of a generic failure.
 *
 * A brand-new Google account on the organization door has no workspace yet, so
 * it is sent to /signup/complete to name one; on the job seeker door it simply
 * becomes a job seeker account, which is what signing up there means.
 */
async function handleGET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const intent = readIntent(searchParams.get('intent'))
  const door = DOOR[intent]

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
  const hasPassword = providers.has('email')

  /** Undo the identity Supabase just linked onto a password account, then refuse. */
  const refuseAndUnlink = async (message: string, reason: string) => {
    await createAdminClient().rpc('remove_google_identity', { p_user_id: user.id })
    await supabase.auth.signOut()
    await audit({
      actorId: user.id,
      actorEmail: user.email ?? null,
      action: 'auth.google_refused',
      entity: 'auth.users',
      entityId: user.id,
      meta: { reason, intent },
      request,
    })
    return fail(message)
  }

  // --- A password account reached through the ORGANIZATION Google door ------
  // Employees and job seekers may use both ways in on one address, so this
  // refusal belongs to the org door alone.
  if (hasPassword && intent !== 'employee' && !isCandidateDoor(intent)) {
    return refuseAndUnlink(
      'This email is registered with a password. Sign in with your email and password instead of Google.',
      'password_account'
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

  // An auth user this exchange brought into existence, with no workspace and no
  // password: nobody has provisioned this address anywhere.
  const stray =
    profile.role === 'org' &&
    !profile.tenant_id &&
    !hasPassword &&
    isFreshlyCreated(user.created_at)

  // --- The EMPLOYEE door ----------------------------------------------------
  if (intent === 'employee') {
    if (profile.role !== 'employee') {
      // The stray is swept up, so the very same address can be added to a
      // workspace later and sign in with Google normally.
      if (stray) {
        await supabase.auth.signOut()
        await createAdminClient().auth.admin.deleteUser(user.id)
        await audit({
          actorEmail: user.email ?? null,
          action: 'auth.google_refused',
          entity: 'auth.users',
          meta: { reason: 'not_linked_to_organization', intent },
          request,
        })
        return fail(
          `${user.email ?? 'That Google account'} is not linked to any organization. Ask your administrator to add this exact email to your workspace, then sign in with Google again.`
        )
      }
      const message =
        'That Google account is not an employee account. Please use the sign-in door for your account type.'
      if (hasPassword) return refuseAndUnlink(message, 'wrong_portal')
      await supabase.auth.signOut()
      return fail(message)
    }
  }

  // --- The JOB SEEKER door --------------------------------------------------
  else if (isCandidateDoor(intent)) {
    if (profile.role !== 'candidate') {
      // Continuing with Google on the job portal IS signing up: a brand-new
      // account becomes a job seeker, which is strictly less privileged than
      // the `org` placeholder handle_new_user() hands every self-signup.
      if (stray) {
        const { error: promoteError } = await createAdminClient()
          .from('profiles')
          .update({ role: 'candidate' })
          .eq('id', user.id)
          .eq('role', 'org')
          .is('tenant_id', null)
        if (promoteError) {
          await supabase.auth.signOut()
          return fail('We could not finish setting up that account. Please try again.')
        }
        await audit({
          actorId: user.id,
          actorEmail: user.email ?? null,
          action: 'auth.candidate_signup_requested',
          entity: 'auth.users',
          entityId: user.id,
          meta: { via: 'google' },
          request,
        })
        return NextResponse.redirect(`${origin}${homeFor('candidate')}`)
      }
      const message =
        'That Google account is not a job seeker account. Please use the sign-in door for your account type.'
      if (hasPassword) return refuseAndUnlink(message, 'wrong_portal')
      await supabase.auth.signOut()
      return fail(message)
    }
  }

  // --- The ORGANIZATION door ------------------------------------------------
  else {
    // Google is the organization door; nobody else's account is created this way.
    if (profile.role !== 'org' && profile.role !== 'super_admin') {
      await supabase.auth.signOut()
      return fail(
        profile.role === 'employee'
          ? 'That is an employee account. Please sign in through the employee portal instead.'
          : 'Sign in with Google is for organization accounts. Please use your email and password.'
      )
    }

    // --- New account: name the workspace first ------------------------------
    if (profile.role === 'org' && !profile.tenant_id) {
      return NextResponse.redirect(`${origin}/signup/complete`)
    }
  }

  if (!profile.is_active) {
    await supabase.auth.signOut()
    return fail('This account has been deactivated. Please contact your administrator.')
  }
  if (
    profile.role !== 'super_admin' &&
    profile.role !== 'candidate' &&
    profile.tenant_status === 'suspended'
  ) {
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
