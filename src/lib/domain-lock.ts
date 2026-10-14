/**
 * "Is this workspace paused for an unproven domain?" — asked in one place, so
 * the answer cannot drift between the guard that locks people out, the banner
 * that warns them it is coming, and the screen that lets them fix it.
 *
 * THE RULE: unverified AND past `domain_verify_due_at` (3 days from signup —
 * 061_seat_limit_and_domain_deadline.sql).
 *
 * DERIVED, NEVER STORED. There is no `paused` column and no cron job that sets
 * one. The state is computed from the two columns 013 already keeps, which
 * means it cannot be stale, it cannot be left behind by a job that failed to
 * run, and it lifts itself the instant verification succeeds — no second write
 * to remember, no window where a verified workspace is still locked out. The
 * header of 061 has the longer argument for why this is not a `tenants.status`
 * value.
 *
 * Deliberately PURE and free of `server-only`: the guards, the API gates, the
 * shell banner and the pause screen all have to agree on what "paused" means,
 * and a second implementation anywhere is a workspace locked out of a screen
 * it should reach, or let into one it should not.
 */

import { daysUntilDeadline } from '@/lib/domain'

/** The window a new workspace gets to prove its website. Mirrors the column default in 061. */
export const DOMAIN_VERIFY_DAYS = 3

/** The shape every caller already has: the tenant slice of `AppContext`. */
export interface DomainLockInput {
  domain: string | null
  domainVerified: boolean
  domainVerifyDueAt: string | null
}

export interface DomainLockState {
  /** True when access is cut off: unverified and the deadline has passed. */
  locked: boolean
  /** Whole days until the deadline; negative once passed, null without one. */
  daysLeft: number | null
  /** True while the deadline is still ahead — the banner's "warn" state. */
  pending: boolean
}

/**
 * The state of one workspace's domain claim.
 *
 * A tenant with NO deadline recorded is never locked. That is a workspace from
 * before 013, or a row read without the column, and refusing to let a customer
 * in because a column was absent would be the worst possible failure mode for
 * a feature whose entire job is to be strict about a date.
 */
export function domainLockState(
  tenant: DomainLockInput | null | undefined,
  now = Date.now()
): DomainLockState {
  if (!tenant || tenant.domainVerified) {
    return { locked: false, daysLeft: null, pending: false }
  }

  const daysLeft = daysUntilDeadline(tenant.domainVerifyDueAt, now)
  if (daysLeft === null) return { locked: false, daysLeft: null, pending: true }

  // `daysUntilDeadline` rounds UP, so a deadline forty minutes in the past is
  // 0, not -1. Compare the instant itself rather than the rounded day, or a
  // workspace stays unlocked for most of the day its time ran out.
  const due = new Date(tenant.domainVerifyDueAt as string).getTime()
  const locked = Number.isFinite(due) && now > due

  return { locked, daysLeft, pending: !locked }
}

/** Where a paused workspace's people are sent. One screen, and it is the fix. */
export const DOMAIN_LOCK_PATH = '/verify-domain'

/** What an API says when it refuses a paused workspace. */
export const DOMAIN_LOCKED_MESSAGE =
  'This workspace is paused until your company website is verified. An administrator can ' +
  'verify it in Settings, or contact support if you need help.'
