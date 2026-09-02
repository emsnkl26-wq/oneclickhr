import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, CheckCircle2 } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { loadEmployeeOnboarding } from '@/lib/employee-onboarding'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { formatLocal } from '@/lib/time'
import { EmployeeOnboardingForm } from './employee-onboarding-form'

export const metadata: Metadata = { title: 'Complete your onboarding' }
export const dynamic = 'force-dynamic'

/**
 * The employee's side of onboarding.
 *
 * Three outcomes, and no fourth:
 *   • nothing outstanding → back to the dashboard. Most of the workforce, most
 *     of the time; there is no page to show them.
 *   • submitted           → a receipt, not a form. Editing underneath a
 *     reviewer is how the two end up disagreeing about what was approved.
 *   • invited             → the form.
 *
 * The org has no currency setting yet (invoices carry their own), so pay is
 * labelled with a plain dollar sign — the same placeholder the org's wizard
 * uses, and the same single place to change when a workspace currency lands.
 */
const DEFAULT_CURRENCY_SYMBOL = '$'

export default async function EmployeeOnboardingPage() {
  const ctx = await requireEmployee()
  const state = await loadEmployeeOnboarding(ctx)

  if (!state) redirect('/employee')

  if (state.status === 'submitted') {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Your details are with your organization"
          description={`${ctx.tenant.name} is reviewing what you submitted.`}
        />
        <div className="card-surface flex max-w-2xl flex-col items-start gap-4 p-6">
          <span className="grid size-10 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-5" aria-hidden />
          </span>
          <div className="space-y-1.5">
            <p className="font-semibold">Submitted{state.submittedAt ? ' ' : ''}
              {state.submittedAt
                ? formatLocal(state.submittedAt, ctx.tenant.timezone, 'd MMM yyyy, HH:mm')
                : null}
            </p>
            <p className="text-sm leading-relaxed text-ink-muted">
              There is nothing more for you to do. If anything needs changing, {ctx.tenant.name}{' '}
              will send the form back to you with a note and you will be notified — it will reopen
              here with everything you already entered still in place.
            </p>
          </div>
          <Button asChild variant="secondary">
            <Link href="/employee">
              <ArrowLeft />
              Back to dashboard
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Complete your onboarding"
        description={`A few details ${ctx.tenant.name} needs. Signed in as ${state.email} — that address is your sign-in and cannot be changed here.`}
      />
      <EmployeeOnboardingForm
        state={state}
        orgName={ctx.tenant.name}
        currencySymbol={DEFAULT_CURRENCY_SYMBOL}
      />
    </div>
  )
}
