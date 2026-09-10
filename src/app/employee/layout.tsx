import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/shell/app-shell'

export const dynamic = 'force-dynamic'

/**
 * Paths an employee may reach while their onboarding is still outstanding.
 *
 * The form itself, obviously — and notifications, because "your details were
 * returned, please fix X" arrives there and would otherwise be unreadable by
 * the one person who needs it.
 *
 * `/change-password` is NOT in this list and does not need to be: it lives at
 * the top level rather than under `/employee`, so this layout never wraps it,
 * and `requireEmployee()` above sends anyone holding a temporary password there
 * before this check is reached.
 */
const ALLOWED_WHILE_PENDING = ['/employee/onboarding', '/employee/notifications']

/**
 * The employee frame — and the gate that makes the org's approval mean
 * something (M2 #8).
 *
 * BEFORE: `/invite` created a live account, the employee filled in their own
 * details, and they had the run of the portal the whole time. The org's review
 * decided whether the answers became their PROFILE, but not whether the account
 * worked — so from the employee's side, submitting and being approved felt
 * identical, and nothing told the organization a review was waiting.
 *
 * NOW: while an onboarding is `invited` or `submitted`, every employee route
 * except the three above redirects to the form. Approval is what opens the
 * portal, which is what "complete account set-up" was always supposed to mean.
 *
 * WHY THE LAYOUT AND NOT MIDDLEWARE: this needs a database read, and
 * src/middleware.ts is deliberately not the authorization boundary — it runs on
 * every navigation and holds no session beyond the cookie. The layout already
 * resolves the caller, so the check costs one indexed query on a page they were
 * loading anyway.
 */
export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireEmployee()

  const pathname = (await headers()).get('x-pathname') ?? ''
  const exempt = ALLOWED_WHILE_PENDING.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )

  if (!exempt) {
    const supabase = await createSupabaseServerClient()
    // RLS scopes this to the caller; `limit(1)` because only one onboarding is
    // ever outstanding for a person.
    /*
     * `completed_at is null` is the condition, NOT the status.
     *
     * A person correcting their address later (M2 #1) also sits at
     * `submitted` while an admin looks at it — and locking them out of the
     * portal for changing their phone number would be absurd. What this gate is
     * for is the account that has never been approved at all, and that is
     * exactly what a null `completed_at` means.
     */
    const { data: pending } = await supabase
      .from('employee_onboarding')
      .select('id')
      .eq('employee_profile_id', ctx.userId)
      .in('status', ['invited', 'submitted'])
      .is('completed_at', null)
      .limit(1)
      .maybeSingle()

    if (pending) redirect('/employee/onboarding')
  }

  return <AppShell ctx={ctx}>{children}</AppShell>
}
