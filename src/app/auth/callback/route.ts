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
 * Something — an auth user, or an identity on one — created by this very
 * exchange rather than at some point in the past.
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
 * Where Google sends someone back to (056, amended 061).
 *
 * ONE ADDRESS, ONE ACCOUNT — but, from 061, not one WAY IN. Every door now
 * works the same way: an address may hold a password AND a Google identity, and
 * either proves the same person.
 *
 * WHAT CHANGED AND WHY IT IS SAFE. The org door used to refuse a password
 * account outright, unlink the Google identity Supabase had just attached, and
 * tell the person to type their password instead. The reasoning was "one
 * address, one way in" — but that rule was never about security, and the proof
 * is that the employee and job seeker doors have always allowed both without
 * anybody considering them weaker. What makes linking safe is the same thing on
 * every door:
 *
 *   • Supabase only links an OAuth identity onto an existing user when the
 *     provider asserts the SAME, VERIFIED email address. Google asserts
 *     `email_verified` on its own domain; an unverified Google email never
 *     links, it becomes its own user.
 *   • So "I control the Google account for this address" and "I know the
 *     password for this address" are two proofs of the same fact. Accepting
 *     either is not a weaker check than accepting one of them — it is the same
 *     check twice, which is exactly how every other product treats it.
 *   • Nothing about the account is taken over by the link: the password still
 *     works, and the Google identity is an addition rather than a replacement.
 *
 * ONE RULE SURVIVES, AND IT IS THE REAL ONE: the account's ROLE still decides
 * which door it may come through. An employee cannot enter through the org
 * door, an org cannot enter through the employee door, and an address nobody
 * has provisioned anywhere is not quietly granted a workspace. That is the
 * check this handler exists for; "which credential did you use" never was.
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

  /**
   * Was the Google identity attached by THIS exchange?
   *
   * It matters because of what `refuseAndUnlink` does. Removing a Google
   * identity is right when the exchange just created it on an account that
   * should not have it; it is destructive when the person linked Google
   * deliberately, through the correct door, weeks ago — now clicking the wrong
   * door once silently takes their second way in away. Since 061 that case is
   * common rather than theoretical: every kind of account may hold both.
   */
  const googleIdentity = (user.identities ?? []).find((identity) => identity.provider === 'google')
  const linkedNow = isFreshlyCreated(googleIdentity?.created_at)

  /** Undo an identity THIS exchange linked onto an account, then refuse. */
  const refuseAndUnlink = async (message: string, reason: string) => {
    if (linkedNow) await createAdminClient().rpc('remove_google_identity', { p_user_id: user.id })
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

  /*
   * A password account reaching a Google door is now ORDINARY, on every door.
   *
   * Supabase has linked the Google identity onto the existing user, which is
   * the intended outcome: one account, two ways to prove it. `hasPassword`
   * stays in scope because the refusals further down still need it — a wrong
   * PORTAL is refused the same as ever, and when that account also has a
   * password the identity Supabase just linked has to be undone, or a refused
   * sign-in would quietly leave a new way into somebody's account behind it.
   */

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
