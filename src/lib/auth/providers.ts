import 'server-only'

/**
 * How an address signs in (056): with a password, through Google, or both.
 *
 * One address has one way in, so the password forms use this to say "this
 * account uses Sign in with Google" instead of a generic failure. That does
 * tell a caller the address is registered, which the rest of the auth flow is
 * careful never to do; it is the explicit product decision for this one case,
 * and it is still behind the same per-IP and per-address rate limits.
 */
import { createAdminClient } from '@/lib/supabase/admin'

export const GOOGLE_ONLY_MESSAGE =
  'This email is registered with Google. Use "Continue with Google" to sign in.'

/** True when the address exists and has a Google identity but no password. */
export async function isGoogleOnlyAccount(email: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc('auth_providers_for_email', { p_email: email })
    if (error || !Array.isArray(data)) return false
    const providers = data as string[]
    return providers.includes('google') && !providers.includes('email')
  } catch {
    // A lookup failure must never turn into a sign-in failure of its own.
    return false
  }
}
