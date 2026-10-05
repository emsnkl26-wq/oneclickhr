import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { forgotPasswordSchema } from '@/lib/schemas'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { limitAuthByIp, rateLimit, limitKey } from '@/lib/rate-limit'
import { appUrl } from '@/lib/env'
import { isGoogleOnlyAccount } from '@/lib/auth/providers'

export const dynamic = 'force-dynamic'

/**
 * Request a password-reset link.
 *
 * ALWAYS answers success. Whether the address exists is not this endpoint's
 * information to give away — and the honest-looking "no account with that email"
 * message is precisely how attackers build a list of valid users.
 *
 * The link itself uses the same device-independent `token_hash` route as signup
 * confirmation, so a reset started on a desktop can be finished on a phone
 * (SETUP.md §4 has the template).
 */
async function handlePOST(request: NextRequest) {
  const ipLimit = await limitAuthByIp(request, 'forgot')
  if (!ipLimit.ok) {
    return jsonError('Too many requests. Please wait a few minutes.', 429)
  }

  const { email } = await parseBody(request, forgotPasswordSchema)

  // Per-address cap so this cannot be used to flood someone's inbox.
  const emailLimit = await rateLimit(limitKey('forgot-email', email), 4, 60 * 60 * 1000)

  // There is no password to reset on a Google account (056) — sending a reset
  // link would quietly ADD one, and with it a second way in.
  if (emailLimit.ok && (await isGoogleOnlyAccount(email))) {
    return jsonOk({
      message: 'This email signs in with Google, so it has no password to reset. Use "Continue with Google".',
    })
  }

  if (emailLimit.ok) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl()}/auth/confirm?type=recovery`,
    })
    // Logged, never surfaced — the response must not vary.
    if (error) console.error('[forgot-password] send failed', error.message)
  }

  return jsonOk({
    message:
      'If that address has an account, a reset link is on its way. It works on any device.',
  })
}

export const POST = withErrorHandler(handlePOST)
