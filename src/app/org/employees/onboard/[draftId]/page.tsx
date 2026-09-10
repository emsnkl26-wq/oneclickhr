import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { requireOrg } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { draftFromRow, draftDisplayName, REVIEW_STEP } from '@/lib/onboarding'
import { accountLast4 } from '@/lib/onboarding-server'
import { OnboardingWizard } from '../onboarding-wizard'
import { loadWizardData } from '../wizard-data'
import type { OnboardingStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Onboarding' }
export const dynamic = 'force-dynamic'

/**
 * Resume a saved draft.
 *
 * Read with the ADMIN client, and therefore re-filtered on the SESSION's tenant
 * id — service_role bypasses RLS, so that filter is the isolation. It is used
 * here for one reason: `account_number_enc` is not selectable by an ordinary
 * session (008), and the page needs to decrypt it to show the last four digits
 * of an already-saved account. The number itself never leaves this function.
 */
export default async function ResumeOnboardingPage({
  params,
}: {
  params: Promise<{ draftId: string }>
}) {
  const ctx = await requireOrg()
  const tenantId = assertTenantScope(ctx.tenantId)
  const { draftId } = await params

  const admin = createAdminClient()
  const { data: row, error: rowError } = await admin
    .from('employee_onboarding')
    .select('*')
    .eq('id', draftId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  /*
   * A draft is five screens of typing about a real person, so "we could not
   * read it" and "it is gone" must not share an answer. notFound() here would
   * tell an admin their half-finished onboarding was deleted — and the only
   * sensible response to that is to start it again from the top.
   */
  if (rowError) {
    console.error('[org/employees/onboard/:draftId] load failed', rowError)
    throw new Error('That onboarding draft could not be loaded. Please try again.')
  }

  if (!row) notFound()
  /*
   * A COMPLETED onboarding is no longer a dead end (M2 #1).
   *
   * It used to redirect to the employee's page, on the reasoning that a
   * finished form can no longer be saved. That is no longer true: this form is
   * the ONLY place most of an employee's record exists — address, work
   * authorization, compensation, bank details — and closing it after approval
   * meant the record was correct exactly once. Saving now re-runs `/complete`,
   * which re-writes the profile from the draft.
   *
   * A CANCELLED one still has nowhere useful to go: it describes somebody who
   * never joined.
   */
  if (row.status === 'cancelled') {
    redirect('/org/employees?tab=drafts')
  }

  const { departments, managers, currencySymbol } = await loadWizardData(ctx)

  const draft = draftFromRow(row)
  const completedSteps: number[] = Array.isArray(row.completed_steps)
    ? (row.completed_steps as number[])
    : []

  const status = row.status as OnboardingStatus

  return (
    <div className="space-y-6">
      <PageHeader
        title={draftDisplayName(draft)}
        description={
          status === 'submitted'
            ? 'They have completed their details. Review everything, then approve it onto their profile.'
            : status === 'invited'
              ? 'Their account is live. Fill the rest in here, or leave it to them — either way you approve it at the end.'
              : status === 'completed'
                ? 'Their full record. Saving at the last step writes any changes onto their profile.'
                : 'Picking up where you left off. Nothing is created until you complete the last step.'
        }
      />
      <OnboardingWizard
        draftId={row.id}
        initialDraft={draft}
        initialStep={Math.min(Math.max(row.current_step ?? 1, 1), REVIEW_STEP)}
        initialCompletedSteps={completedSteps}
        departments={departments}
        managers={managers}
        accountLast4={accountLast4(row.account_number_enc)}
        currencySymbol={currencySymbol}
        initialStatus={status}
        employeeProfileId={row.employee_profile_id ?? null}
        submittedAt={row.submitted_at ?? null}
      />
    </div>
  )
}
