import 'server-only'

/**
 * The employee seat limit (061).
 *
 * Every workspace gets 20 employee accounts. The product is given away, so this
 * is what keeps "free" finite; an org that needs more asks us, and a super
 * admin raises `tenants.employee_limit` for that one workspace.
 *
 * WHAT COUNTS IS AN ACTIVE EMPLOYEE, and nothing else:
 *
 *   • Deactivated people do not. Someone who has left the organization is gone
 *     from it in every other sense (see /api/org/employees/[id]) and holding a
 *     seat would be the one place they lingered — an org that replaces a leaver
 *     would hit the cap for a person who no longer works there.
 *   • Org administrators do not. The limit is on the team, not on the people
 *     running the account; charging the owner a seat for existing would mean a
 *     two-admin workspace quietly has 18 seats.
 *   • Onboarding drafts WITHOUT an account do not, because they are paperwork.
 *     The instant an account is minted (`/invite` or `/complete`) the profile
 *     exists and is counted like any other.
 *
 * WHY THE CHECK IS HERE AND NOT IN THE DATABASE. A constraint or trigger would
 * have to count another table on every profile write, and it would fire deep
 * inside a five-step onboarding that has already created an auth user — the
 * caller would get a bare 23514 and we would be left rolling back an account.
 * Called at the TOP of the two handlers that mint an account, it refuses before
 * anything exists and says who to ask. That is a check, not a guarantee: two
 * simultaneous invites can both pass it and land on 21. That is the right
 * trade — the failure is one seat of overshoot on a soft commercial limit,
 * against a hard failure mid-provisioning for every org that is nowhere near it.
 */
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

/** The allowance every workspace starts with. Mirrors the column default in 061. */
export const DEFAULT_EMPLOYEE_LIMIT = 20

export interface SeatUsage {
  /** Active employee accounts in this workspace right now. */
  used: number
  /** What this workspace is allowed. Per-tenant, raised by the platform. */
  limit: number
  /** Never negative — an org whose limit was lowered below its headcount reads 0. */
  remaining: number
  full: boolean
}

/**
 * How many seats this workspace has used, and how many it has.
 *
 * ADMIN CLIENT, scoped by an explicit `tenant_id` from the caller's session.
 * The count has to be true regardless of what the caller can see, and an org
 * that could read a smaller number than the real one could talk itself past
 * its own limit.
 */
export async function seatUsage(admin: Admin, tenantId: string): Promise<SeatUsage> {
  const [{ data: tenant }, { count }] = await Promise.all([
    admin.from('tenants').select('employee_limit').eq('id', tenantId).maybeSingle(),
    admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'employee')
      .eq('is_active', true),
  ])

  // A null limit is a database without 061 applied. Falling back to the default
  // keeps the rule in force rather than handing out unlimited seats on a
  // half-migrated deploy.
  const limit = (tenant as { employee_limit: number | null } | null)?.employee_limit ?? DEFAULT_EMPLOYEE_LIMIT
  const used = count ?? 0

  return { used, limit, remaining: Math.max(0, limit - used), full: used >= limit }
}

/** The sentence an org reads when it has run out. Names the number and the way forward. */
export function seatLimitMessage(usage: SeatUsage): string {
  return (
    `Your workspace has reached its limit of ${usage.limit} employee ` +
    `${usage.limit === 1 ? 'account' : 'accounts'}. Deactivate someone who has left, or contact ` +
    'support to have the limit raised for your organization.'
  )
}

/**
 * "May this workspace add one more employee?"
 *
 * Returns the usage either way, so a caller that refuses can report the numbers
 * and a caller that proceeds does not have to ask again.
 */
export async function checkSeatAvailable(
  admin: Admin,
  tenantId: string
): Promise<{ ok: true; usage: SeatUsage } | { ok: false; usage: SeatUsage; error: string }> {
  const usage = await seatUsage(admin, tenantId)
  if (usage.full) return { ok: false, usage, error: seatLimitMessage(usage) }
  return { ok: true, usage }
}
