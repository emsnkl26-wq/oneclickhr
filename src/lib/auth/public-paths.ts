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
  /*
   * THE JOB PORTAL — the only part of this product that is public by intent
   * rather than by necessity.
   *
   * `/jobs` covers `/jobs/<id>` and `/jobs/company/<slug>` through the sub-path
   * rule below; `/api/jobs` covers `apply`, `resume-presign` and `logo`. Note
   * what is NOT here: `/org/jobs` and `/super/jobs` are the ADMIN side of the
   * same feature and stay behind their guards. The near-identical names are the
   * trap in this entry — an over-eager `/jobs` prefix rule that also matched
   * those would publish every draft posting and every applicant's CV.
   *
   * `/robots.txt` and `/sitemap.xml` are here because a portal a crawler cannot
   * read is not a portal; both are generated from published jobs only.
   */
  '/jobs',
  '/api/jobs',
  '/robots.txt',
  '/sitemap.xml',
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

/**
 * A machine endpoint whose configured URL carries a trailing slash, mapped back
 * to its canonical path — otherwise `null`.
 *
 * Next answers `/api/auth/send-email-hook/` with a 308 to the slash-less path.
 * A browser follows that invisibly; a webhook sender either refuses to follow a
 * redirect on a POST or re-issues it as a GET, and either way the handler never
 * runs and the auth action it was serving fails. The URL is typed into a
 * third-party dashboard by hand, so the trailing slash is a matter of when, not
 * if. Middleware rewrites instead of redirecting, which keeps the method, the
 * body and the `webhook-*` signature headers intact.
 */
export function canonicalMachinePath(pathname: string): string | null {
  if (!pathname.endsWith('/') || pathname === '/') return null
  const withoutSlash = pathname.replace(/\/+$/, '')
  return (MACHINE_PATHS as readonly string[]).includes(withoutSlash) ? withoutSlash : null
}
