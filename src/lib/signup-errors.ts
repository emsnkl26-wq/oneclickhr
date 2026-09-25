import 'server-only'

/**
 * What a failed `supabase.auth.signUp` means, in words a person can act on.
 *
 * Shared by the organization sign-up and the job-seeker sign-up (052): both
 * call the same GoTrue endpoint through the same Send Email hook, so they fail
 * the same ways, and the explanations must not drift apart.
 *
 * Returns null when the error only says "this address is already registered".
 * Callers answer that exactly like a success: "that email is already in use"
 * is a free account-existence oracle on a public endpoint, and Supabase sends
 * the real owner a notice instead.
 */
import { jsonError } from '@/lib/api'

export function signupErrorResponse(
  error: { message?: string; status?: number; code?: string },
  email: string,
  context: string
): Response | null {
  const message = (error.message || '').toLowerCase()
  const isExistence =
    message.includes('already registered') ||
    message.includes('already been registered') ||
    message.includes('user already exists')
  if (isExistence) return null

  // Log the machine-readable parts too — a bare message cannot tell a
  // throttled email apart from a failing Send Email hook.
  console.error(`[${context}] failed`, {
    to: email.replace(/^(.).*(@.*)$/, '$1***$2'),
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
  if (error.status === 429 || message.includes('rate limit') || message.includes('too many')) {
    return jsonError(
      'Too many sign-up emails have been sent recently. Please try again in a little while.',
      429
    )
  }
  if (message.includes('signups not allowed') || message.includes('signup is disabled')) {
    return jsonError('Sign-ups are temporarily closed. Please contact support.', 503)
  }
  if (message.includes('invalid') && message.includes('email')) {
    return jsonError('That email address was rejected. Please use a different address.', 400)
  }
  if (typeof error.status === 'number' && error.status >= 500) {
    return jsonError(
      'We could not send the confirmation email just now. Please try again in a few ' +
        'minutes — your details were not saved.',
      503
    )
  }
  return jsonError('We could not complete your sign-up. Please try again.', 400)
}
