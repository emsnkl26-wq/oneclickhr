import 'server-only'

/**
 * The one place the server learns who is calling.
 *
 * Four rules this module exists to enforce:
 *
 * 1. The access token is always VERIFIED, never merely decoded. `getSession()`
 *    reads the cookie and trusts it; that is fine for a middleware redirect and
 *    not fine for an authorization decision. Verification happens one of two
 *    ways — see `verifyCaller()` — and both prove the token is genuine,
 *    unexpired and backed by a session that still exists.
 *
 * 2. `is_active` is read from the database on every request, not from the JWT.
 *    A token lives for an hour; deactivation has to bite now (§3).
 *
 * 3. The verified identity is CHECKED AGAINST the profile row. Two independent
 *    things resolve the caller — the token we verify here, and `auth.uid()`
 *    inside `current_profile()` — and they must name the same person.
 *
 * 4. It is memoized per request. A single navigation asks "who is calling?" from
 *    the layout guard, the page guard and sometimes a nested helper; without
 *    `cache()` each of those repeated the whole round trip.
 */
import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { brandColorOrDefault } from '@/lib/brand'
import type { UserRole, TenantStatus, TrackingMode, CurrentProfile } from '@/types/db'

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
    /**
     * The currency every money figure in this workspace is reported in (033).
     * Totals are never converted into it — rows in another currency are counted
     * and reported as excluded, because a wrong rate is worse than an honest
     * omission.
     */
    defaultCurrency: string
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
 * A verified caller: who the token says they are, proven.
 *
 * `email` is the token's copy and is only ever a FALLBACK for the profile row's
 * — see the context assembly below.
 */
interface VerifiedCaller {
  userId: string
  email: string | null
}

/**
 * Verify the access token WITHOUT asking the auth server.
 *
 * This project signs its JWTs with ES256, so `getClaims()` fetches the public
 * key from the project's JWKS endpoint and checks the signature with WebCrypto
 * — no network on the request path, because auth-js caches the key set in a
 * module-level global for ten minutes, which outlives the per-request client.
 * It also rejects an expired token.
 *
 * It is SAFE on a project that has not migrated to asymmetric keys. `getClaims`
 * inspects the token header first and, for an `HS*` algorithm it cannot verify
 * locally, falls back to `getUser()` internally. It never returns claims it has
 * not proven, so the worst case here is the old latency, not a weaker check.
 *
 * Two claims are asserted beyond the signature:
 *
 *   • `sub` must be a non-empty string — it becomes the identity.
 *   • `role` must be `authenticated`. The project's own anon and service keys
 *     are JWTs too; this is what stops one being presented as a user session.
 *
 * The issuer is deliberately NOT compared against a configured URL. The binding
 * is the key: the signature is checked against THIS project's JWKS, so a token
 * minted by any other Supabase project fails verification outright. A string
 * comparison would add nothing and would break custom auth domains.
 */
async function verifyLocally(
  supabase: SupabaseClient,
  accessToken: string
): Promise<VerifiedCaller | null> {
  const { data, error } = await supabase.auth.getClaims(accessToken)
  const claims = data?.claims
  if (error || !claims) return null

  const sub = claims.sub
  if (typeof sub !== 'string' || !sub) return null
  if (claims.role !== 'authenticated') return null

  return { userId: sub, email: typeof claims.email === 'string' ? claims.email : null }
}

/** Verify by asking the auth server — genuine, unexpired AND unrevoked. */
async function verifyWithAuthServer(supabase: SupabaseClient): Promise<VerifiedCaller | null> {
  const { data, error } = await supabase.auth.getUser()
  const user = data?.user
  if (error || !user) return null
  return { userId: user.id, email: user.email ?? null }
}

/**
 * Is the database able to answer "is this session still live?" — that is, has
 * migration 060 been applied, and can it read `auth.sessions`?
 *
 * Local verification proves a token is genuine; only something stateful can
 * prove the session behind it has not been revoked. `current_profile()` answers
 * that in the round trip we already pay for, but ONLY once 060 is in place, and
 * this module has to behave correctly on both sides of that deploy.
 *
 * So the capability is probed rather than assumed, and a negative answer
 * EXPIRES. Without the expiry, a process that happened to start before the
 * migration would stay on the slow path until it was restarted; with it, the
 * fast path switches itself on within ten minutes of the migration landing.
 *
 * `null` means "not yet probed", and the first request of a process optimistically
 * tries the fast path — which is safe, because a missing answer is treated as no
 * evidence and falls through to the auth server below.
 */
let sessionCheckAvailable: boolean | null = null
let sessionCheckProbedAt = 0
const SESSION_CHECK_REPROBE_MS = 10 * 60 * 1000

function sessionCheckUsable(): boolean {
  if (sessionCheckAvailable === null) return true
  if (sessionCheckAvailable) return true
  return Date.now() - sessionCheckProbedAt > SESSION_CHECK_REPROBE_MS
}

function noteSessionCheck(available: boolean): void {
  if (!available && sessionCheckAvailable !== false) {
    console.warn(
      '[auth] current_profile() returned no usable session_active — falling back to the auth ' +
        'server for revocation checks. Apply migration 060_local_jwt_verification.sql.'
    )
  }
  sessionCheckAvailable = available
  sessionCheckProbedAt = Date.now()
}

/**
 * Resolve the caller.
 *
 * Returns the context even for a DEACTIVATED user or a SUSPENDED tenant — the
 * callers below are what turn those states into the right redirect, and the UI
 * needs to know which of the two happened to explain itself.
 *
 * THE SHAPE, and why it is the whole performance story:
 *
 *   1. `getSession()` — no network when the cookie is fresh. A signed-out
 *      visitor is answered here without touching Supabase at all, and an
 *      expired token is refreshed ONCE, before anything else can race on it.
 *   2. Verification and `current_profile` in PARALLEL. Neither one's input
 *      depends on the other's output, and step 1 is what makes racing them safe.
 *   3. Verification still gates the result — a profile fetched alongside a
 *      verification that comes back rejected is thrown away, so this is faster
 *      without being one bit more trusting.
 *
 * What changed, and what it bought:
 *
 * Step 2 used to be `getUser()`, a round trip to the auth server. Parallel, so
 * it cost the SLOWER of the two — and `/auth/v1/user` measures about three
 * times slower than PostgREST on this project, so it set the latency floor
 * under every authenticated request in the product. Verifying the ES256
 * signature locally removes that trip entirely.
 *
 * REVOCATION IS NOT TRADED AWAY FOR IT. A locally verified token says nothing
 * about whether its session still exists, so the session check moved into the
 * `current_profile()` trip instead (migration 060). Three outcomes, and the
 * third is the one that keeps this honest:
 *
 *   true   the session is live — accept, no auth-server call.
 *   false  the session is gone (signed out, password changed, revoked) —
 *          reject, exactly as `getUser()` would have.
 *   null   no evidence either way: 060 not applied, or `auth.sessions`
 *          unreadable. Fall back to the auth server and verify properly.
 *
 * The third case is why this is safe to deploy before the migration, and why a
 * database problem degrades to the old latency rather than to a weaker check or
 * a lockout.
 */
async function loadContextUncached(): Promise<ContextResult> {
  const supabase = await createSupabaseServerClient()

  // Local: decodes the cookie, and refreshes only if the token has expired.
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) return { status: 'anonymous' }

  // When the database cannot vouch for the session, the auth server has to, and
  // doing that here keeps it PARALLEL with the profile read. Discovering it
  // afterwards would make the two trips serial — slower than before the change.
  const canCheckSession = sessionCheckUsable()

  const [verified, { data, error: rpcError }] = await Promise.all([
    canCheckSession
      ? verifyLocally(supabase, session.access_token)
      : verifyWithAuthServer(supabase),
    supabase.rpc('current_profile'),
  ])

  if (!verified) return { status: 'anonymous' }

  const row = Array.isArray(data) ? data[0] : data

  if (rpcError || !row) {
    // Authenticated but not provisioned: the migrations have not been applied to
    // this database, or the profile trigger landed after this user signed up.
    // Never guess a role — an unresolvable session gets no access at all.
    console.warn('[auth] no profile row for user', verified.userId, rpcError?.message)
    return {
      status: 'orphaned',
      userId: verified.userId,
      reason: rpcError?.message ?? 'no profile row',
    }
  }

  /*
   * The two resolutions must agree.
   *
   * `verified.userId` comes from the token this module checked; `row.id` comes
   * from `auth.uid()` inside `current_profile()`, which PostgREST derives from
   * the same token using its own configured key. They can only disagree if one
   * of those two paths is misconfigured, and the safe reading of that is "we do
   * not know who this is" — not "pick one".
   */
  if (row.id !== verified.userId) {
    console.error('[auth] identity mismatch between verified token and profile row')
    return { status: 'anonymous' }
  }

  if (canCheckSession) {
    // `undefined` (060 not applied) and `null` (cannot tell) are the same thing
    // here — no evidence — and neither may be read as "live". See CurrentProfile.
    const sessionActive: CurrentProfile['session_active'] = row.session_active
    if (sessionActive === false) {
      // The token is genuine, but the session behind it has been revoked.
      return { status: 'anonymous' }
    }
    if (sessionActive !== true) {
      /*
       * No evidence. Remember that, so subsequent requests race the auth server
       * against the profile read instead of discovering this again, and settle
       * THIS request the strict way before letting it through.
       */
      noteSessionCheck(false)
      if (!(await verifyWithAuthServer(supabase))) return { status: 'anonymous' }
    } else if (sessionCheckAvailable !== true) {
      noteSessionCheck(true)
    }
  }

  const ctx: AppContext = {
    userId: row.id,
    email: row.email ?? verified.email ?? '',
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
          primaryColor: brandColorOrDefault(row.tenant_primary_color),
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
          // USD when the column is absent (034 not applied yet), matching the
          // column default and the default `invoices.currency` has had since 001.
          defaultCurrency: row.tenant_default_currency ?? 'USD',
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
    case 'candidate':
      return '/candidate'
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
  // Neither the platform nor a job seeker (052) belongs to a workspace.
  if (ctx.role === 'super_admin' || ctx.role === 'candidate') return true
  if (ctx.tenant?.status !== 'active') return false
  return true
}
