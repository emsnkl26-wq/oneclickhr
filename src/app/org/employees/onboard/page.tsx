import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/patterns'
import { emptyDraft } from '@/lib/onboarding'
import { OnboardingWizard } from './onboarding-wizard'
import { loadWizardData } from './wizard-data'

export const metadata: Metadata = { title: 'Onboard an employee' }
export const dynamic = 'force-dynamic'

/**
 * A brand-new onboarding.
 *
 * No draft row is created up front — an org that opens this page and changes
 * its mind should leave nothing behind. The row appears on the first save
 * (autosave, "Next", or "Save for later"), and the wizard swaps the URL to
 * /org/employees/onboard/<id> at that moment so a refresh resumes.
 */
export default async function OnboardEmployeePage() {
  const ctx = await requireOrg()
  const { departments, managers, currencySymbol } = await loadWizardData(ctx)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboard an employee"
        description="Fill it all in yourself, or add their name and email and let them complete their own details — you review either way."
      />
      <OnboardingWizard
        draftId={null}
        initialDraft={emptyDraft({ country: 'US', employmentStatus: 'Active' })}
        initialStep={1}
        initialCompletedSteps={[]}
        departments={departments}
        managers={managers}
        accountLast4={null}
        currencySymbol={currencySymbol}
      />
    </div>
  )
}
