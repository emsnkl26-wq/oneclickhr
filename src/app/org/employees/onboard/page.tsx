import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { PageHeader } from '@/components/ui/patterns'
import { CreateEmployeeForm } from './create-employee-form'

export const metadata: Metadata = { title: 'Add an employee' }
export const dynamic = 'force-dynamic'

/**
 * Adding someone to the team.
 *
 * This used to open the six-step onboarding wizard on a blank draft, with no
 * account created until the last field was filled. It now opens a three-field
 * form that creates the account immediately — see `create-employee-form.tsx`
 * for why, and for the fork that follows it.
 *
 * The wizard still exists and is still the only place the full details are
 * entered; it simply lives one step further in, at
 * /org/employees/onboard/<draftId>, where there is always a real account behind
 * it. Drafts started under the old flow resume there unchanged.
 */
export default async function AddEmployeePage() {
  await requireOrg()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add an employee"
        description="Create their account first — it takes three fields. The rest of the onboarding details can be filled in by you or by them."
      />
      <CreateEmployeeForm />
    </div>
  )
}
