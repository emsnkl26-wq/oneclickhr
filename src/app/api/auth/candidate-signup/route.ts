import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { candidateSignupSchema } from '@/lib/schemas'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { limitAuthByIp, rateLimit, limitKey } from '@/lib/rate-limit'
import { signupErrorResponse } from '@/lib/signup-errors'
import { audit } from '@/lib/audit'
import { appUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * A job seeker creates an account (052).
 *
 * The same GoTrue sign-up the organization door uses, with one difference in
 * the UNTRUSTED metadata: `signup_as: 'candidate'`. `handle_new_user()` may
 * only use that to LOWER the default self-signup role (org, which gets a whole
 * workspace) to candidate (which gets none) — see the header of 052. Nothing
 * in this payload can raise anybody's privileges.
 *
 * Answers identically whether or not the address is already registered, like
 * the org sign-up: that answer is otherwise an account-existence oracle.
 */
async function handlePOST(request: NextRequest) {
  const ipLimit = await limitAuthByIp(request, 'candidate-signup')
  if (!ipLimit.ok) {
    return jsonError('Too many sign-up attempts. Please wait a few minutes.', 429)
  }

  const input = await parseBody(request, candidateSignupSchema)

  const emailLimit = await rateLimit(
    limitKey('candidate-signup-email', input.email),
    5,
    60 * 60 * 1000
  )
  if (!emailLimit.ok) {
    return jsonError('Too many sign-up attempts for that address. Please try again later.', 429)
  }

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName, signup_as: 'candidate' },
      emailRedirectTo: `${appUrl()}/auth/confirm`,
    },
  })

  if (error) {
    const failure = signupErrorResponse(error, input.email, 'candidate-signup')
    if (failure) return failure
  }

  await audit({
    action: 'auth.candidate_signup_requested',
    entity: 'auth.users',
    request,
  })

  return jsonOk({
    message:
      'Check your inbox — we have sent a confirmation link. Confirm your email, then sign in to apply.',
  })
}

export const POST = withErrorHandler(handlePOST)
