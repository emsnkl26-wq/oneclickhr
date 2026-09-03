'use client'

/**
 * "Add employee", in three fields.
 *
 * WHY THIS IS THE FRONT DOOR AND THE WIZARD IS NOT
 * -----------------------------------------------
 * Onboarding collects about sixty fields, and most of them belong to the person
 * being onboarded: their address, their visa, their bank account, their next of
 * kin. Opening with all of that asked the org to be a data-entry clerk for
 * information it had to chase by email first — so the form stalled on field
 * eight and the new starter had no account for a week.
 *
 * What an ACCOUNT actually needs is a name and an email address. So that is all
 * this asks. The account exists seconds later, and the sixty fields become a
 * choice rather than a wall:
 *
 *   • the org fills them in, whenever it has them, from the employee's page; or
 *   • the employee fills in their own share and the org reviews it.
 *
 * Neither path is a dead end — an org that picks one can switch to the other at
 * any time, because both are editing the same draft.
 *
 * The screen has TWO STATES and no navigation between them. Once the account is
 * created the temporary password exists in this component and nowhere else in
 * the world, so routing away would destroy it; the result state renders in
 * place, and the two onward buttons are the only exits.
 */

import * as React from 'react'
import Link from 'next/link'
import { useProgressRouter } from '@/lib/use-progress-router'
import { ArrowRight, CheckCircle2, ClipboardList, Send, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { Checkbox } from '@/components/ui/checkbox'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { CredentialsPanel } from './credentials-panel'
import type { NewCredentials } from '@/lib/new-credentials'

interface InviteResult extends NewCredentials {
  /** The new employee's profile id. */
  id: string
}

export function CreateEmployeeForm() {
  const router = useProgressRouter()

  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [sendEmail, setSendEmail] = React.useState(true)

  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)

  /**
   * The draft this created, kept so a failed SECOND call can be retried without
   * making a duplicate row. Creating the draft and creating the account are two
   * requests — the first is cheap and reversible, the second is the one that
   * mints an auth user — and this is what keeps a retry from doubling up.
   */
  const draftIdRef = React.useRef<string | null>(null)
  const [result, setResult] = React.useState<InviteResult | null>(null)

  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()

    const found: Record<string, string> = {}
    if (!firstName.trim()) found.firstName = 'Enter their first name'
    if (!lastName.trim()) found.lastName = 'Enter their last name'
    if (!email.trim()) found.personalEmail = 'Enter their email address'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      found.personalEmail = 'Enter a valid email address'
    }
    setErrors(found)
    if (Object.keys(found).length) return

    setBusy(true)
    try {
      if (!draftIdRef.current) {
        const created = await apiPost<{ id: string }>('/api/org/onboarding', {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          personalEmail: email.trim().toLowerCase(),
          // Country and employment status have sensible defaults the wizard
          // would otherwise make somebody pick twice.
          country: 'US',
          employmentStatus: 'Active',
        })
        draftIdRef.current = created.id
      }

      const invited = await apiPost<InviteResult>(
        `/api/org/onboarding/${draftIdRef.current}/invite`,
        { sendCredentialsEmail: sendEmail }
      )
      setResult(invited)
    } catch (err) {
      if (err instanceof ApiClientError) {
        // The server owns the questions this form cannot answer — chiefly
        // whether the email address is already taken.
        const fields = readFieldErrors(err)
        if (fields) setErrors(fields)
        toast.error(err.message)
      } else {
        toast.error('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  /* ----------------------------------------------------------- The result */

  if (result) {
    return (
      <div className="max-w-2xl space-y-6">
        <div className="card-surface space-y-5 p-6">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">
                {fullName || 'The employee'}&rsquo;s account is ready
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                They can sign in straight away. Their onboarding details are still to come — until
                those are complete and approved, they show as <strong>Onboarding</strong> rather
                than an active member of the team.
              </p>
            </div>
          </div>

          <CredentialsPanel credentials={result} />
        </div>

        <div>
          <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
            Who fills in the rest of the details?
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            Either way you can change your mind later — it is the same form, and you review it
            before it becomes their profile.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <ChoiceCard
              icon={ClipboardList}
              title="I'll fill them in"
              description="Open the full onboarding form now, or come back to it from their employee page whenever you have what you need."
              action="Open the form"
              href={`/org/employees/onboard/${draftIdRef.current}`}
            />
            <ChoiceCard
              icon={Send}
              title="They'll fill them in"
              description={
                result.emailSent
                  ? 'They have the login. Signing in takes them straight to their own onboarding form, and you will be asked to review it.'
                  : 'Share the sign-in details above. Signing in takes them straight to their own onboarding form, and you will be asked to review it.'
              }
              action="Done for now"
              onClick={() => router.push('/org/employees?tab=drafts')}
            />
          </div>
        </div>
      </div>
    )
  }

  /* ------------------------------------------------------------- The form */

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-6" noValidate>
      <div className="card-surface space-y-5 p-6">
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <FormField label="First name" error={errors.firstName} required>
            <Input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </FormField>
          <FormField label="Last name" error={errors.lastName} required>
            <Input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="off"
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              label="Email address"
              error={errors.personalEmail}
              required
              hint="This becomes their sign-in email. It cannot be changed later."
            >
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                placeholder="name@example.com"
              />
            </FormField>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-page px-3.5 py-3">
          <Checkbox
            checked={sendEmail}
            onChange={(e) => setSendEmail(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-[13px] leading-relaxed">
            <span className="font-medium text-ink">Email them their sign-in details</span>
            <span className="mt-0.5 block text-ink-muted">
              A temporary password they replace on first sign-in. Leave this off and you can copy
              the details on the next screen instead.
            </span>
          </span>
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" loading={busy}>
          <UserPlus />
          Create account
        </Button>
        <Button asChild variant="secondary" type="button">
          <Link href="/org/employees">Cancel</Link>
        </Button>
      </div>
    </form>
  )
}

/** One of the two onward paths. A card, because this is a real fork. */
function ChoiceCard({
  icon: Icon, title, description, action, href, onClick,
}: {
  icon: React.ElementType
  title: string
  description: string
  action: string
  href?: string
  onClick?: () => void
}) {
  return (
    <div className="card-surface flex flex-col p-5">
      <span className="grid size-9 place-items-center rounded-lg bg-brand-50 text-brand-700">
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mt-1 flex-1 text-[13px] leading-relaxed text-ink-muted">{description}</p>
      {href ? (
        <Button asChild variant="secondary" className="mt-4 w-full">
          <Link href={href}>
            {action}
            <ArrowRight />
          </Link>
        </Button>
      ) : (
        <Button variant="secondary" className="mt-4 w-full" onClick={onClick}>
          {action}
          <ArrowRight />
        </Button>
      )}
    </div>
  )
}

/**
 * Pull field messages out of a failure.
 *
 * The invite endpoint reports problems by STEP (it is shared with the wizard,
 * where a field's step is what you need to know). This form has no steps, so
 * step 1's messages — the only ones that can name a field it shows — are
 * flattened onto it.
 */
function readFieldErrors(err: ApiClientError): Record<string, string> | null {
  const steps = err.payload?.steps as Record<number, Record<string, string>> | undefined
  if (steps?.[1]) return steps[1]
  return err.fields && Object.keys(err.fields).length ? err.fields : null
}
