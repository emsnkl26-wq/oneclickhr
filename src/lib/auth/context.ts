import 'server-only'

/**
 * The one place the server learns who is calling.
 *
 * Two rules this module exists to enforce:
 *
 * 1. `getUser()`, never `getSession()`. `getSession()` decodes the cookie and
 *    trusts it. That is fine for a middleware redirect, and NOT fine for an
 *    authorization decision — `getUser()` round-trips to the auth server and
 *    verifies the token is genuine and unrevoked. Every Route Handler and
 *    Server Action goes through here, so every one of them re-verifies.
 *
 * 2. `is_active` is read from the database on every request, not from the JWT.
 *    A token lives for an hour; deactivation has to bite now (§3).
 *
 * 3. It is memoized per request. A single navigation asks "who is calling?" from
 *    the layout guard, the page guard and sometimes a nested helper; without
 *    `cache()` each of those repeated the whole round trip.
 */
import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { UserRole, TenantStatus, TrackingMode } from '@/types/db'

export interface AppContext {
  userId: string
  email: string
  role: UserRole
  tenantId: string | null
  fullName: string | null
  photoUrl: string | null
  departmentId: string | null
  /**
   * Clock, timesheet, or neither (025) — or NULL, meaning nobody has decided.
   *
   * NULL IS NOT A SYNONYM FOR 'clock_in', and conflating the two is a mistake
   * worth calling out because it was made once already. Defaulting an unset
   * mode to `clock_in` silently applied the restriction to every employee in
   * every workspace the moment the code shipped: Timesheets vanished from their
   * sidebar and `POST /api/timesheets` started refusing them, without a single
   * organization having chosen anything.
   *
   * So null means UNRESTRICTED — the behaviour everyone had before this feature
   * existed. The narrowing only applies to an employee an org has deliberately
   * put into one mode or the other.
   */
  trackingMode: TrackingMode | null
  /** True for the person who created the workspace (027). */
  isOwner: boolean
  isActive: boolean
  mustChangePassword: boolean
  tenant: {
    id: string
    name: string
    slug: string
    status: TenantStatus
    logoUrl: string | null
    primaryColor: string
    timezone: string
    workStartTime: string
    onboarded: boolean
    /** The company website this workspace claims. Null on pre-013 workspaces. */
    domain: string | null
    /** Whether that claim has been PROVEN. Only this drives the banner. */
    domainVerified: boolean
    /**
     * When the workspace is expected to have proven it. A DEADLINE FOR THE
     * BANNER'S TONE — nothing is cut off when it passes.
     */
    domainVerifyDueAt: string | null
    /** What a NEW employee inherits. Never a runtime fallback (025). */
    defaultTrackingMode: TrackingMode | null
  } | null
}

/**
 * Three outcomes, kept apart on purpose.
 *
 * `anonymous` and `orphaned` used to collapse into a single `null`, and that is
 * what produced the sign-in redirect loop: an orphaned user was sent to /login,
 * middleware saw a perfectly valid session cookie and sent them straight back to
 * their portal, forever. A session that exists but cannot be resolved to a
 * profile is its OWN failure and needs its own dead end — see /session-invalid.
 */
export type ContextResult =
  | { status: 'anonymous' }
  | { status: 'orphaned'; userId: string; reason: string }
  | { status: 'ok'; ctx: AppContext }

/**
 * Resolve the caller.
 *
 * Returns the context even for a DEACTIVATED user or a SUSPENDED tenant — the
 * callers below are what turn those states into the right redirect, and the UI
 * needs to know which of the two happened to explain itself.
 *
 * THREE STEPS, and the order of them is the whole performance story:
 *
 *   1. `getSession()` — no network when the cookie is fresh. A signed-out
 *      visitor is answered here without touching Supabase at all, and an
 *      expired token is refreshed ONCE, before anything else can race on it.
 *   2. `getUser()` and `current_profile` in PARALLEL. They used to run in
 *      series, which put two sequential round trips in front of every single
 *      page render for no reason: neither one's input depends on the other's
 *      output. Step 1 is what makes racing them safe.
 *   3. The verification still gates the result — a profile fetched alongside a
 *      `getUser()` that comes back rejected is thrown away, so this is faster
 *      without being one bit more trusting.
 */
async function loadContextUncached(): Promise<ContextResult> {
  const supabase = await createSupabaseServerClient()

  // Local: decodes the cookie, and refreshes only if the token has expired.
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return { status: 'anonymous' }

  const [{ data: userData, error }, { data, error: rpcError }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('current_profile'),
  ])

  const user = userData?.user
  if (error || !user) return { status: 'anonymous' }

  const row = Array.isArray(data) ? data[0] : data

  if (rpcError || !row) {
    // Authenticated but not provisioned: the migrations have not been applied to
    // this database, or the profile trigger landed after this user signed up.
    // Never guess a role — an unresolvable session gets no access at all.
    console.warn('[auth] no profile row for user', user.id, rpcError?.message)
    return {
      status: 'orphaned',
      userId: user.id,
      reason: rpcError?.message ?? 'no profile row',
    }
  }

  const ctx: AppContext = {
    userId: row.id,
    email: row.email ?? user.email ?? '',
    role: row.role as UserRole,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    photoUrl: row.photo_url,
    departmentId: row.department_id,
    // Defaults are what a database without 025/027 applied yet reports: the
    // behaviour everyone had before those migrations, rather than a crash.
    // No fallback, deliberately. An absent column (025 not applied yet) and an
    // employee nobody has assigned a mode to are the same thing: unrestricted.
    trackingMode: (row.tracking_mode ?? null) as TrackingMode | null,
    isOwner: !!row.is_owner,
    isActive: !!row.is_active,
    mustChangePassword: !!row.must_change_password,
    tenant: row.tenant_id
      ? {
          id: row.tenant_id,
          name: row.tenant_name ?? 'Workspace',
          slug: row.tenant_slug ?? '',
          status: (row.tenant_status ?? 'active') as TenantStatus,
          logoUrl: row.tenant_logo_url,
          primaryColor: row.tenant_primary_color ?? '#C41E33',
          timezone: row.tenant_timezone ?? 'Asia/Kolkata',
          workStartTime: row.tenant_work_start_time ?? '09:30',
          onboarded: !!row.tenant_onboarded,
          domain: row.tenant_domain ?? null,
          // Defaults FALSE when the column is absent — a database that has not
          // had 013 applied yet shows the banner rather than silently treating
          // every workspace as verified.
          domainVerified: !!row.tenant_domain_verified,
          domainVerifyDueAt: row.tenant_domain_due_at ?? null,
          // Null when the org has not chosen. New employees then inherit nothing,
          // which means no restriction — see the header of 025.
          defaultTrackingMode: (row.tenant_default_tracking_mode ?? null) as TrackingMode | null,
        }
      : null,
  }

  return { status: 'ok', ctx }
}

/**
 * The request-scoped entry point. Every guard goes through this, so a page that
 * checks authorization in its layout AND in its body pays for exactly one
 * resolution.
 */
export const resolveContext = cache(loadContextUncached)

/**
 * Convenience wrapper for callers that only care whether there is a usable
 * caller. Prefer `resolveContext()` anywhere the answer decides a redirect —
 * `null` cannot tell "signed out" apart from "session with no profile".
 */
export async function loadContext(): Promise<AppContext | null> {
  const result = await resolveContext()
  return result.status === 'ok' ? result.ctx : null
}

/** The landing route for a role — the single source of truth for redirects. */
export function homeFor(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return '/super'
    case 'org':
      return '/org'
    default:
      return '/employee'
  }
}

/**
 * Is this context allowed to do real work right now? A deactivated profile or a
 * suspended tenant answers false, and the caller sends them somewhere that
 * explains why.
 */
export function isUsable(ctx: AppContext): boolean {
  if (!ctx.isActive) return false
  if (ctx.role !== 'super_admin' && ctx.tenant?.status !== 'active') return false
  return true
}
