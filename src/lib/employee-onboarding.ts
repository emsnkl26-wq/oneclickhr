import 'server-only'

/**
 * Loading an employee's OWN onboarding draft — the one shared piece between the
 * page that renders their form and the two route handlers that write it.
 *
 * WHY THE SERVICE ROLE, AND WHY THAT IS NOT A SHORTCUT
 * ----------------------------------------------------
 * `employee_onboarding` is invisible to employees at the RLS level, and 014
 * deliberately left it that way. The row holds `internal_notes`,
 * `compliance_notes` and the pay the org has decided — things the SUBJECT of
 * the row must not read. Postgres column privileges are granted per ROLE, not
 * per row, so "let the employee read their row but not those columns" cannot be
 * expressed in the grant system at all.
 *
 * So the employee's access is mediated here instead, and the mediation is the
 * whole security argument:
 *
 *   • the row is found BY `employee_profile_id = <the caller>`, never by an id
 *     from the request — an employee cannot ask for someone else's draft
 *     because there is nowhere to put the request;
 *   • `tenant_id` is re-filtered from the SESSION, as every service-role query
 *     in this codebase does;
 *   • what comes back to the browser is the draft filtered through
 *     `EMPLOYEE_STEPS` (see `employeeVisibleDraft`), so the org-only columns are
 *     dropped before they can reach a page.
 */
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import {
  draftFromRow, emptyDraft, EMPLOYEE_EDITABLE_KEYS, EMPLOYEE_REVIEW_STEP,
  type OnboardingDraft,
} from '@/lib/onboarding'
import { accountLast4 } from '@/lib/onboarding-server'
import type { OnboardingStatus } from '@/types/db'

/** The statuses in which an employee is allowed to EDIT their own draft. */
export const EMPLOYEE_EDITABLE_STATUSES: readonly OnboardingStatus[] = ['invited']

export interface EmployeeOnboardingState {
  id: string
  status: OnboardingStatus
  /** The employee's own position in their four-step version of the wizard. */
  step: number
  completedSteps: number[]
  /** Their share of the draft. Org-only fields are blank here by construction. */
  draft: OnboardingDraft
  /** Last four digits of a bank account they have already saved, if any. */
  accountLast4: string | null
  /** What the org asked them to fix, when it sent the form back. */
  reviewNotes: string | null
  submittedAt: string | null
  invitedAt: string | null
  /** Sign-in email. Shown, never edited — it is their identity, not a field. */
  email: string
  editable: boolean
}

/**
 * The draft as the EMPLOYEE may see it: their own fields, nothing else.
 *
 * Blanking rather than deleting keeps the shape a full `OnboardingDraft`, which
 * is what the form components expect — and means a field accidentally rendered
 * outside `EMPLOYEE_STEPS` would show empty rather than leak the org's answer.
 */
export function employeeVisibleDraft(full: OnboardingDraft): OnboardingDraft {
  const visible = emptyDraft()
  for (const key of Object.keys(visible) as (keyof OnboardingDraft)[]) {
    if (!EMPLOYEE_EDITABLE_KEYS.has(key)) continue
    if (key === 'additionalDocs') {
      visible.additionalDocs = full.additionalDocs
      continue
    }
    visible[key] = full[key]
  }
  return visible
}

/**
 * The onboarding this employee is being asked to fill in, or null.
 *
 * Null is the ordinary answer for most of the workforce: anyone onboarded the
 * old way, or whose onboarding has been approved, has nothing outstanding.
 * Completed and cancelled rows return null for the same reason — there is
 * nothing left to ask of them.
 */
export async function loadEmployeeOnboarding(ctx: {
  userId: string
  tenantId: string | null
  email: string
}): Promise<EmployeeOnboardingState | null> {
  const tenantId = assertTenantScope(ctx.tenantId)
  const admin = createAdminClient()

  const { data: row, error } = await admin
    .from('employee_onboarding')
    .select('*')
    .eq('employee_profile_id', ctx.userId)
    .eq('tenant_id', tenantId)
    .in('status', ['invited', 'submitted'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[employee-onboarding] load failed', error.message)
    return null
  }
  if (!row) return null

  const status = row.status as OnboardingStatus

  return {
    id: row.id,
    status,
    step: Math.min(Math.max(row.employee_step ?? 1, 1), EMPLOYEE_REVIEW_STEP),
    completedSteps: Array.isArray(row.employee_completed_steps)
      ? (row.employee_completed_steps as number[])
      : [],
    draft: employeeVisibleDraft(draftFromRow(row)),
    // The last four digits only, decrypted here and nowhere nearer the browser
    // — the same hint the org's wizard gets, for the same reason.
    accountLast4: accountLast4(row.account_number_enc),
    reviewNotes: row.review_notes ?? null,
    submittedAt: row.submitted_at ?? null,
    invitedAt: row.invited_at ?? null,
    email: ctx.email,
    editable: EMPLOYEE_EDITABLE_STATUSES.includes(status),
  }
}
