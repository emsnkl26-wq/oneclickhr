import 'server-only'

/**
 * CLIENT #2 of 3 — the server user-scoped client.
 *
 * Cookie-bound, anon key, running as the REAL signed-in user. This is the
 * default for all normal tenant CRUD and, importantly, for EVERY creation path:
 * running as the user means RLS `WITH CHECK` and any BEFORE-INSERT validation
 * trigger actually fire. Reach for the admin client only when an operation is
 * genuinely impossible under RLS (creating auth users, cross-tenant super-admin
 * reads, cron).
 */
import { cache } from 'react'
import { cookies } from 'next/headers'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

/** The shape `setAll` receives. Annotated because the `cookies` option is a union. */
type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Memoized for the lifetime of ONE request.
 *
 * A page renders its layout, its guard and several data calls, and every one of
 * them asked for a client of its own — each rebuilding the cookie adapter and
 * re-reading the cookie store. Worse, each client carries its own auth state, so
 * a token refresh done by one was invisible to the next. `cache()` is
 * request-scoped (never shared between users), so all of them now share one
 * client and one refresh.
 */
export const createSupabaseServerClient = cache(async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Called from a Server Component, where cookies are read-only. The
            // middleware refreshes the session, so dropping the write here is
            // correct rather than an error.
          }
        },
      },
    }
  )
})
