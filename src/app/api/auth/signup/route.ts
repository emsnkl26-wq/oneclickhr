import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { signupSchema } from '@/lib/schemas'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { limitAuthByIp, rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { appUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'

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

  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      // Untrusted display data only. The role is forced to 'org' in the trigger.
      data: {
        org_name: input.orgName,
        full_name: input.fullName,
      },
      // Must match the Supabase "Site URL"/redirect allowlist. The confirmation
      // TEMPLATE is what carries the token_hash link (SETUP.md §4); this is the
      // fallback target Supabase appends to it.
      emailRedirectTo: `${appUrl()}/auth/confirm`,
    },
  })

  if (error) {
    // Real infrastructure failures still surface; only existence is hidden.
    const message = (error.message || '').toLowerCase()
    const isExistence =
      message.includes('already registered') ||
      message.includes('already been registered') ||
      message.includes('user already exists')

    if (!isExistence) {
      // Log the machine-readable parts too. A bare message string is not enough
      // to tell "Supabase throttled the confirmation email" apart from "the
      // Send Email hook returned 500" from a production log line, and both of
      // those used to arrive here as the same opaque 400.
      console.error('[signup] failed', {
        // Redacted so a support ticket can be matched to a log line without the
        // log becoming an address list.
        to: input.email.replace(/^(.).*(@.*)$/, '***'),
        status: error.status,
        code: error.code,
        message: error.message,
        hint:
          typeof error.status === 'number' && error.status >= 500
            ? 'GoTrue 5xx on signUp almost always means the Send Email hook returned ' +
              'non-2xx — look for the [send-email-hook] line just after this one.'
            : undefined,
      })

      if (message.includes('password')) {
        return jsonError('Please choose a stronger password.', 400)
      }

      // Confirmation email could not be sent: the Send Email hook answered
      // non-2xx, or Resend rejected the address/domain. The account was not
      // created, so retrying is the right advice — but "try again" alone sends
      // the user into a loop that cannot succeed until the sender is fixed.
      if (
        message.includes('error sending') ||
        message.includes('sending confirmation') ||
        message.includes('sending email') ||
        message.includes('email hook') ||
        message.includes('failed to send')
      ) {
        return jsonError(
          'We could not send the confirmation email to that address. Please check the ' +
            'address, or try again in a few minutes.',
          503
        )
      }

      // Supabase's own throttle (2 confirmation emails/hour on the built-in
      // sender). Distinct from our per-IP limiter above, and a 400 here made it
      // look like the form data was bad.
      if (error.status === 429 || message.includes('rate limit') || message.includes('too many')) {
        return jsonError(
          'Too many sign-up emails have been sent recently. Please try again in a little while.',
          429
        )
      }

      if (message.includes('signups not allowed') || message.includes('signup is disabled')) {
        return jsonError('Sign-ups are temporarily closed. Please contact support.', 503)
      }

      // A rejected address — Supabase and Resend both refuse some domains
      // (including most disposable-mail ones).
      if (message.includes('invalid') && message.includes('email')) {
        return jsonError(
          'That email address was rejected. Please use your work email address.',
          400
        )
      }

      // A 5xx from GoTrue is never the caller's fault, and its message is often
      // empty (a failing Send Email hook surfaces as literally ' { }'). Answering
      // 400 blamed the form for a server-side outage.
      if (typeof error.status === 'number' && error.status >= 500) {
        return jsonError(
          'We could not send the confirmation email just now. Please try again in a few ' +
            'minutes — your details were not saved.',
          503
        )
      }

      return jsonError('We could not complete your sign-up. Please try again.', 400)
    }
  }

  await audit({
    action: 'auth.signup_requested',
    entity: 'auth.users',
    meta: { org_name: input.orgName },
    request,
  })

  return jsonOk({
    message:
      'Check your inbox — we have sent a confirmation link. You can open it on any device.',
  })
}

export const POST = withErrorHandler(handlePOST)
