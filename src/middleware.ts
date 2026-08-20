import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

/** The shape `setAll` receives. Annotated because the `cookies` option is a union. */
type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Session refresh + role-based routing.
 *
 * SCOPE: this is ROUTING ONLY. It reads the session cookie and trusts it, which
 * is fine for deciding where to send a browser — the worst case is an
 * unnecessary redirect. It is NOT an authorization boundary. Every Route Handler
 * and Server Action re-verifies with `getUser()` through the gate helpers in
 * src/lib/auth/guards.ts, and RLS is underneath all of it.
 *
 * The role comes from the `user_role` claim minted by the access-token hook, so
 * routing costs no database round-trip.
 */

/** Pages a signed-out visitor may reach. */
const PUBLIC_PATHS = [
  '/login',
  '/employee-login',
  '/signup',
  '/forgot-password',
  '/auth/confirm',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/signout',
  // Machine callers. None of these carry a session cookie, so without an entry
  // here middleware answers the POST with a 307 to /login — and a webhook sender
  // that follows a redirect re-issues it as a GET, which the handler cannot
  // answer. For the Supabase Send Email hook that failure is not cosmetic: a
  // non-2xx aborts the auth action, so every sign-up dies at 'Error sending
  // confirmation email'.
  '/api/auth/send-email-hook',
  '/api/cron',
  '/api/integrations/google/webhook',
]

/**
 * Routes a signed-in user may visit regardless of role.
 *
 * `/session-invalid` earns its place here for the same reason it exists: it is
 * where an unresolvable session is parked, so middleware must never route it
 * away on the strength of a role claim it does not have.
 */
const ROLE_NEUTRAL = [
  '/change-password',
  '/reset-password',
  '/account-inactive',
  '/workspace-suspended',
  '/session-invalid',
  '/api/',
  '/auth/',
]

const ROLE_HOME: Record<string, string> = {
  super_admin: '/super',
  org: '/org',
  employee: '/employee',
}

const ROLE_PREFIX: Record<string, string> = {
  super_admin: '/super',
  org: '/org',
  employee: '/employee',
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Matches on a path SEGMENT boundary, never a bare prefix: a plain `startsWith`
 * would hand `/account-inactive-evil` the same free pass as `/account-inactive`.
 * Entries that already end in `/` are namespace prefixes and match as written.
 */
function isRoleNeutral(pathname: string): boolean {
  return ROLE_NEUTRAL.some((p) =>
    p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)
  )
}

/**
 * Read the `user_role` claim without verifying the signature.
 *
 * Deliberate: a forged claim can only send someone to the wrong dashboard, where
 * the real gate rejects them. Verifying here would mean a network round-trip on
 * every navigation for no security gain.
 */
function roleFromToken(accessToken: string | undefined): string | null {
  if (!accessToken) return null
  try {
    const payload = accessToken.split('.')[1]
    if (!payload) return null
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const claims = JSON.parse(json) as { user_role?: string }
    return claims.user_role ?? null
  } catch {
    return null
  }
}

export async function middleware(request: NextRequest) {
  /*
   * PREFETCHES GET OUT EARLY.
   *
   * Now that every route has a `loading.tsx`, Next prefetches the sidebar's
   * links as they enter the viewport — a dozen or more speculative requests per
   * page, each one previously paying for a cookie decode and, at the edge of an
   * hour, a token refresh. None of that work has anywhere to go: a redirect
   * returned to a prefetch is discarded, and a rotated cookie set on a response
   * the browser never navigates to is thrown away with it.
   *
   * Skipping them costs nothing in safety. This function was never the
   * authorization boundary (see the note above) — the page guards and RLS are —
   * and the real navigation that follows runs the full path.
   */
  if (request.headers.get('next-router-prefetch') === '1') {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refreshes the access token and writes the rotated cookies onto `response`.
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const { pathname } = request.nextUrl

  // --- Not signed in -------------------------------------------------------
  if (!session) {
    if (isPublic(pathname)) return response
    // Send them to the door that matches where they were headed. A session that
    // expires under an employee mid-shift should not resurface on the admin
    // sign-in, which would refuse the only password they have.
    const door = pathname === '/employee' || pathname.startsWith('/employee/')
      ? '/employee-login'
      : '/login'
    const redirectUrl = new URL(door, request.url)
    // Preserve the destination so sign-in can return the user to it.
    if (pathname !== '/') redirectUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  const role = roleFromToken(session.access_token)
  const home = (role && ROLE_HOME[role]) || '/employee'

  // --- Signed in, on an auth page -> go home -------------------------------
  const AUTH_PAGES = ['/', '/login', '/employee-login', '/signup']
  if (AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL(home, request.url))
  }

  if (isRoleNeutral(pathname)) return response

  // --- Cross-role access is blocked ---------------------------------------
  if (role) {
    const allowedPrefix = ROLE_PREFIX[role]
    const inOwnArea = pathname === allowedPrefix || pathname.startsWith(`${allowedPrefix}/`)
    const inSomeoneElsesArea = Object.entries(ROLE_PREFIX).some(
      ([r, prefix]) => r !== role && (pathname === prefix || pathname.startsWith(`${prefix}/`))
    )
    if (inSomeoneElsesArea && !inOwnArea) {
      return NextResponse.redirect(new URL(home, request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Auth cookies must be
     * refreshed on real navigations, not on every icon request.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
