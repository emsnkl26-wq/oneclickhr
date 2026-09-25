import { type EmailOtpType } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { withErrorHandler } from '@/lib/api'
import { audit } from '@/lib/audit'

/**
 * DEVICE-INDEPENDENT email confirmation and password recovery.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY NOT THE DEFAULT `?code=` LINK                                        │
 * │                                                                          │
 * │ Supabase's default confirmation link uses the PKCE `code` flow. Exchang-  │
 * │ ing that code requires the `code_verifier` that was generated in the      │
 * │ browser that STARTED the signup and stored in its localStorage. Sign up   │
 * │ on a laptop, open the email on your phone — different browser, no         │
 * │ verifier, and the link fails with "invalid request: both auth code and    │
 * │ code verifier should be non-empty". People check email on their phones,   │
 * │ so this is not an edge case; it is most of them.                          │
 * │                                                                          │
 * │ The `token_hash` flow carries everything needed inside the link itself.   │
 * │ verifyOtp runs HERE, on the server, with no browser state at all, so the  │
 * │ link works from any device, any browser, even a webmail preview fetch.    │
 * │                                                                          │
 * │ Configure the template link as:                                          │
 * │   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const dynamic = 'force-dynamic'

async function handleGET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  const toLogin = (params: string) => NextResponse.redirect(`${origin}/login?${params}`)
  const errored = (msg: string) => toLogin(`error=${encodeURIComponent(msg)}`)

  if (!tokenHash || !type) {
    return errored(
      'That confirmation link is incomplete. Please use the most recent link in your email, or request a new one.'
    )
  }

  /*
   * Rate limit per TOKEN, not per IP.
   *
   * IP keying is NAT-hostile: mobile carriers put thousands of users behind one
   * egress address (CGNAT), and a corporate office is one address too — an
   * IP-keyed limit would start rejecting legitimate confirmations during any
   * signup surge. Keying on the high-entropy token hash throttles hammering of a
   * SINGLE link, which is the only thing worth throttling here; the token space
   * is far too large to enumerate, and Supabase applies its own per-project
   * limits underneath.
   */
  const limited = await rateLimit(limitKey('auth-confirm', tokenHash), 10, 10 * 60 * 1000)
  if (!limited.ok) {
    return errored('Too many attempts on that link. Please wait a few minutes and try again.')
  }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })

  if (error || !data.user) {
    return errored(
      'That link is invalid or has expired. If you have already confirmed your email, just sign in below.'
    )
  }

  const user = data.user

  /*
   * RECOVERY keeps the session. verifyOtp has just proved control of the
   * mailbox, and setting a new password requires an authenticated call — on THIS
   * device, which is exactly where the person is standing.
   */
  if (type === 'recovery') {
    await audit({
      actorId: user.id,
      actorEmail: user.email ?? null,
      action: 'auth.recovery_link_verified',
      entity: 'auth.users',
      entityId: user.id,
      request,
    })
    return NextResponse.redirect(`${origin}/reset-password`)
  }

  /*
   * SIGNUP does NOT keep the session.
   *
   * verifyOtp mints one as a side effect. Leaving it would sign the user in on
   * whichever device happened to open the email — frequently a phone, when they
   * signed up on a laptop — and the laptop would still be sitting on an
   * unauthenticated page. Signing out here makes the outcome unambiguous
   * everywhere: the email is confirmed, now sign in. No half-session.
   */
  await supabase.auth.signOut()

  await audit({
    actorId: user.id,
    actorEmail: user.email ?? null,
    action: 'auth.email_confirmed',
    entity: 'auth.users',
    entityId: user.id,
    request,
  })

  const confirmed = `message=${encodeURIComponent('Your email is confirmed. Please sign in to continue.')}`
  // A job seeker (052) signs in at the job portal's door, not the org one. The
  // metadata only picks the page to land on; the login route decides access.
  if (user.user_metadata?.signup_as === 'candidate') {
    return NextResponse.redirect(`${origin}/jobs/login?${confirmed}`)
  }
  return toLogin(confirmed)
}

export const GET = withErrorHandler(handleGET)
