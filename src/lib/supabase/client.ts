'use client'

/**
 * CLIENT #1 of 3 — the browser client.
 *
 * Anon key + cookie adapter. Every query it makes is RLS-scoped to the signed-in
 * user, so it is safe to use directly from client components for reads and for
 * Realtime subscriptions. It can never see another tenant's rows because the
 * policies in 002_rls.sql are evaluated by Postgres, not by this code.
 *
 * Mutations still go through Server Actions / Route Handlers so they are Zod
 * validated and audited in one place.
 */
import { createBrowserClient } from '@supabase/ssr'

let cached: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  if (cached) return cached
  const client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  /*
   * KEEP THE REALTIME SOCKET AUTHENTICATED.
   *
   * With cookie-based SSR auth the socket can otherwise connect with only the
   * anon key, and a `postgres_changes` subscription evaluated as the anon role
   * matches no RLS-protected rows — so live message/receipt events never
   * arrive and the thread looks frozen until a manual reload. Feeding the
   * socket the user's JWT (now, and on every refresh) is what makes Supabase
   * Realtime actually deliver this person's rows. `onAuthStateChange` fires an
   * INITIAL_SESSION event immediately, so the token is set right after
   * creation; broadcast does not need this, but postgres_changes does.
   */
  client.auth.onAuthStateChange((_event, session) => {
    client.realtime.setAuth(session?.access_token ?? null)
  })

  cached = client
  return cached
}
