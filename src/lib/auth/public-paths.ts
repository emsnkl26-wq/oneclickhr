/**
 * Which paths a request without a session may reach.
 *
 * Lives outside middleware.ts so it can be unit-tested. NO imports beyond this
 * file's own types — middleware runs on the edge runtime, and `server-only`
 * modules (or anything pulling in Node built-ins) cannot be reached from there.
 *
 * Getting this list wrong is not a small bug. A machine caller that is missing
 * here gets a 307 to /login instead of its handler; a webhook sender follows
 * that redirect as a GET, the handler never runs, and the caller sees a non-2xx
 * it cannot explain. That is exactly how the Supabase Send Email hook silently
 * broke every sign-up on production.
 */

/** Pages and endpoints a signed-out human may reach. */
export const PUBLIC_HUMAN_PATHS = [
  '/login',
  '/employee-login',
  '/signup',
  '/forgot-password',
  '/auth/confirm',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/signout',
] as const

/**
 * Endpoints called by other SERVERS, never by a browser. None of them can carry
 * a session cookie, so none of them may ever be behind the session redirect.
 * Each authenticates itself instead:
 *   • send-email-hook  — Standard Webhooks HMAC signature
 *   • cron             — CRON_SECRET bearer token
 *   • google/webhook   — channel token issued at subscription time
 */
export const MACHINE_PATHS = [
  '/api/auth/send-email-hook',
  '/api/cron',
  '/api/integrations/google/webhook',
] as const

export const PUBLIC_PATHS: readonly string[] = [...PUBLIC_HUMAN_PATHS, ...MACHINE_PATHS]

/**
 * Matches a path or one of its sub-paths — never a bare string prefix, so
 * `/login-evil` does not inherit `/login`'s free pass.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}
