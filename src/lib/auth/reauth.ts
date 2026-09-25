import 'server-only'

/**
 * Re-check the CURRENT user's password before an irreversible action.
 *
 * A live session proves somebody signed in at some point; it does not prove
 * the person at the keyboard now is them — an unlocked laptop is enough to
 * hold one. Deleting an organization or a person cannot be undone, so the
 * platform console asks for the password again.
 *
 * The check signs in on a THROWAWAY client (no cookies, no persistence), so the
 * caller's own session is untouched, and that extra session is signed out at
 * once. It is rate limited per user so it cannot be used to guess a password.
 */
import { createClient } from '@supabase/supabase-js'
import { rateLimit, limitKey } from '@/lib/rate-limit'

export type ReauthResult = { ok: true } | { ok: false; error: string; status: number }

export async function verifyOwnPassword(
  userId: string,
  email: string,
  password: string
): Promise<ReauthResult> {
  const limited = await rateLimit(limitKey('reauth', userId), 5, 15 * 60 * 1000)
  if (!limited.ok) {
    return { ok: false, error: 'Too many attempts. Wait a few minutes and try again.', status: 429 }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon || !email || !password) {
    return { ok: false, error: 'Your password could not be checked.', status: 400 }
  }

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user || data.user.id !== userId) {
    return { ok: false, error: 'That password is not correct.', status: 403 }
  }

  // Only this throwaway session — the caller stays signed in.
  await client.auth.signOut({ scope: 'local' }).catch(() => undefined)
  return { ok: true }
}
