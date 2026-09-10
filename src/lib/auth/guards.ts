import 'server-only'

/**
 * Server authorization gates — defense in depth behind RLS.
 *
 * Two flavours of the same rules, because pages and APIs need different
 * failures:
 *   • `requireX()`  — for Server Components / pages. Redirects.
 *   • `apiRequireX()` — for Route Handlers / Server Actions. Returns a
 *     discriminated union so the caller answers with a status code.
 *
 * They share `loadContext()`, so there is exactly one implementation of each
 * rule. Note in particular that `requireOrg` insists on an ACTIVE profile in an
 * ACTIVE tenant: filtering on role alone leaves the deactivated-user hole open,
 * because a role does not disappear when someone is switched off.
 */
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { resolveContext, homeFor, isUsable, type AppContext } from '@/lib/auth/context'
import { safeEqual } from '@/lib/crypto'
import { rateLimit, limitKey, getClientIp } from '@/lib/rate-limit'

export type { AppContext }

export interface OrgContext extends AppContext {
  tenantId: string
  tenant: NonNullable<AppContext['tenant']>
}

// ---------------------------------------------------------------------------
// Page guards — redirect on failure
// ---------------------------------------------------------------------------

export async function requireUser(): Promise<AppContext> {
  const result = await resolveContext()
  if (result.status === 'anonymous') redirect('/login')
  // A valid session we cannot resolve to a profile must NOT go to /login:
  // middleware would bounce it straight back here on the strength of the cookie.
  // /session-invalid is a terminal page whose only exit is signing out.
  if (result.status === 'orphaned') redirect('/session-invalid')
  const ctx = result.ctx
  if (!ctx.isActive) redirect('/account-inactive')
  if (ctx.role !== 'super_admin' && ctx.tenant?.status === 'suspended') {
    redirect('/workspace-suspended')
  }
  // A teammate signing in for the first time is confined to one route until the
  // system-issued temporary password is replaced.
  if (ctx.mustChangePassword) redirect('/change-password')
  return ctx
}

export async function requireRole(role: AppContext['role']): Promise<AppContext> {
  const ctx = await requireUser()
  if (ctx.role !== role) redirect(homeFor(ctx.role))
  return ctx
}

/**
 * The wrong-role case and the no-tenant case cannot share an exit.
 *
 * `homeFor(role)` is right for the first — send an employee back to /employee —
 * but for the second it is the very route that just rejected them, and the guard
 * would bounce them into it again on the next request. A profile whose tenant
 * never got provisioned has no portal to go to, so it goes to the dead end.
 */
function leaveTenantArea(ctx: AppContext, expected: AppContext['role']): never {
  redirect(ctx.role === expected ? '/session-invalid' : homeFor(ctx.role))
}

/** An ACTIVE org user in an ACTIVE tenant. */
export async function requireOrg(): Promise<OrgContext> {
  const ctx = await requireUser()
  if (ctx.role !== 'org' || !ctx.tenantId || !ctx.tenant) leaveTenantArea(ctx, 'org')
  return ctx as OrgContext
}

/** An ACTIVE employee in an ACTIVE tenant. */
export async function requireEmployee(): Promise<OrgContext> {
  const ctx = await requireUser()
  if (ctx.role !== 'employee' || !ctx.tenantId || !ctx.tenant) leaveTenantArea(ctx, 'employee')
  return ctx as OrgContext
}

export async function requireSuperAdmin(): Promise<AppContext> {
  const ctx = await requireUser()
  if (ctx.role !== 'super_admin') redirect(homeFor(ctx.role))
  return ctx
}

/** Either role, for pages both portals share (meetings, kanban, notifications). */
export async function requireTenantUser(): Promise<OrgContext> {
  const ctx = await requireUser()
  // A super admin has no tenant by design and belongs on /super; anyone else
  // without one is unprovisioned, and homeFor() would only loop them back here.
  if (!ctx.tenantId || !ctx.tenant) {
    redirect(ctx.role === 'super_admin' ? homeFor(ctx.role) : '/session-invalid')
  }
  return ctx as OrgContext
}

// ---------------------------------------------------------------------------
// API guards — return a Response on failure
// ---------------------------------------------------------------------------

export type Gate<T> = { ok: true; ctx: T } | { ok: false; response: NextResponse }

const deny = (message: string, status: number): { ok: false; response: NextResponse } => ({
  ok: false,
  response: NextResponse.json({ error: message }, { status }),
})

export async function apiRequireUser(): Promise<Gate<AppContext>> {
  const result = await resolveContext()
  if (result.status === 'anonymous') return deny('Not authenticated', 401)
  if (result.status === 'orphaned') {
    // 403, not 401: the credentials are genuine, the account is unusable.
    return deny('This account is not fully set up. Please contact your administrator.', 403)
  }
  if (!isUsable(result.ctx)) return deny('This account is no longer active', 403)
  return { ok: true, ctx: result.ctx }
}

export async function apiRequireOrg(): Promise<Gate<OrgContext>> {
  const gate = await apiRequireUser()
  if (!gate.ok) return gate
  if (gate.ctx.role !== 'org' || !gate.ctx.tenantId || !gate.ctx.tenant) {
    return deny('Organization access required', 403)
  }
  return { ok: true, ctx: gate.ctx as OrgContext }
}

/**
 * The workspace's OWNER, not merely an administrator (027).
 *
 * Invited admins have the same access to /org as the owner — every screen,
 * every action. Three things are deliberately not among them, and they are all
 * the same thing: the ability to take the workspace away from the person who
 * created it.
 *
 *   • inviting another admin
 *   • revoking an admin
 *   • changing the company domain (the workspace's identity)
 *
 * Without this an invited admin could revoke the founder and rename the
 * company, which is not a permission system anybody asked for.
 */
export async function apiRequireOwner(): Promise<Gate<OrgContext>> {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate
  if (!gate.ctx.isOwner) {
    return deny('Only the workspace owner can do that.', 403)
  }
  return gate
}

export async function apiRequireEmployee(): Promise<Gate<OrgContext>> {
  const gate = await apiRequireUser()
  if (!gate.ok) return gate
  if (gate.ctx.role !== 'employee' || !gate.ctx.tenantId || !gate.ctx.tenant) {
    return deny('Employee access required', 403)
  }
  return { ok: true, ctx: gate.ctx as OrgContext }
}

export async function apiRequireTenantUser(): Promise<Gate<OrgContext>> {
  const gate = await apiRequireUser()
  if (!gate.ok) return gate
  if (!gate.ctx.tenantId || !gate.ctx.tenant) return deny('Workspace access required', 403)
  return { ok: true, ctx: gate.ctx as OrgContext }
}

export async function apiRequireSuperAdmin(): Promise<Gate<AppContext>> {
  const gate = await apiRequireUser()
  if (!gate.ok) return gate
  if (gate.ctx.role !== 'super_admin') return deny('Platform administrator access required', 403)
  return { ok: true, ctx: gate.ctx }
}

// ---------------------------------------------------------------------------
// Cron guard
// ---------------------------------------------------------------------------

/**
 * Authenticate a scheduled job.
 *
 * `safeEqual` rather than `===` so the secret cannot be recovered a byte at a
 * time from response timing, and a per-IP limit first so the endpoint cannot be
 * hammered to probe it (or to trigger expensive work). Returns null to proceed.
 */
export async function requireCron(request: Request, job: string): Promise<NextResponse | null> {
  const limited = await rateLimit(limitKey(`cron:${job}`, getClientIp(request)), 30, 60 * 1000)
  if (!limited.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const configured = process.env.CRON_SECRET
  if (!configured || configured.length < 16) {
    // 503, not 401: the job is not misauthenticated, the server is misconfigured.
    // An external scheduler surfaces this as a failed run, not a silent no-op.
    return NextResponse.json({ error: 'Cron is not configured' }, { status: 503 })
  }

  const provided = request.headers.get('x-cron-secret') || ''
  if (!safeEqual(provided, configured)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return null
}
