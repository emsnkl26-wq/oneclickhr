'use client'

/**
 * Onboardings in progress — everything that is not yet a finished employee.
 *
 * THREE THINGS SHARE THIS LIST, AND THE DIFFERENCE IS WHO IS HOLDING THE PEN
 * -------------------------------------------------------------------------
 *   draft     — the org is still typing. No account exists, so this one can be
 *               deleted outright: nothing references it.
 *   invited   — the account exists and the employee is filling in their own
 *               details. Not deletable; a real person can already sign in.
 *   submitted — they are done and an admin has to review it. The only card that
 *               is actually asking for something, so it says so loudest.
 *
 * The card's primary button follows that: Resume, Add details, or Review.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight, ClipboardList, Clock, Trash2, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/patterns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { apiDelete, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { cn } from '@/lib/utils'
import { ONBOARDING_STEPS } from '@/lib/onboarding'
import type { OnboardingStatus } from '@/types/db'

export interface DraftRow {
  id: string
  first_name: string | null
  last_name: string | null
  personal_email: string | null
  designation: string | null
  current_step: number
  completed_steps: number[] | null
  status: OnboardingStatus
  employee_profile_id: string | null
  invited_at: string | null
  submitted_at: string | null
  created_at: string
  updated_at: string
}

const TOTAL = ONBOARDING_STEPS.length

export function DraftList({ drafts, timezone }: { drafts: DraftRow[]; timezone: string }) {
  const router = useRouter()
  const [pending, setPending] = React.useState<DraftRow | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function remove(draft: DraftRow) {
    setBusy(true)
    try {
      await apiDelete(`/api/org/onboarding/${draft.id}`)
      toast.success('Draft deleted')
      setPending(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That draft could not be deleted')
    } finally {
      setBusy(false)
    }
  }

  if (!drafts.length) {
    return (
      <div className="card-surface overflow-hidden">
        <EmptyState
          icon={ClipboardList}
          title="No onboardings in progress"
          description="Start onboarding someone and you can save your work at any point — or hand them the login and let them fill in their own details."
          action={
            <Button asChild>
              <Link href="/org/employees/onboard">Onboard an employee</Link>
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {drafts.map((draft) => {
          const done = (draft.completed_steps ?? []).length
          const name =
            [draft.first_name, draft.last_name].filter(Boolean).join(' ').trim() ||
            draft.personal_email ||
            'Unnamed draft'
          const status = draft.status ?? 'draft'
          const isDraft = status === 'draft'
          const submitted = status === 'submitted'

          return (
            <li
              key={draft.id}
              className={cn(
                'card-surface flex flex-col p-5',
                submitted && 'ring-1 ring-emerald-200'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{name}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    {draft.designation || 'No job title yet'}
                  </p>
                </div>
                {isDraft ? (
                  <button
                    type="button"
                    aria-label={`Delete the draft for ${name}`}
                    onClick={() => setPending(draft)}
                    className="focus-ring shrink-0 rounded p-1 text-ink-muted transition hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>

              <StatusLine status={status} />

              {isDraft ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink-muted">
                      {done} of {TOTAL} steps completed
                    </span>
                    <span className="tabular text-ink-muted">
                      {Math.round((done / TOTAL) * 100)}%
                    </span>
                  </div>
                  <div
                    className="mt-2 h-1.5 overflow-hidden rounded-full bg-page"
                    role="progressbar"
                    aria-valuenow={done}
                    aria-valuemin={0}
                    aria-valuemax={TOTAL}
                    aria-label={`${name} onboarding progress`}
                  >
                    <div
                      className="h-full rounded-full bg-brand-600 transition-[width]"
                      style={{ width: `${(done / TOTAL) * 100}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <p className="mt-4 text-xs text-ink-muted">
                {submitted && draft.submitted_at
                  ? `Submitted ${formatLocal(draft.submitted_at, timezone, 'd MMM, HH:mm')}`
                  : status === 'invited' && draft.invited_at
                    ? `Invited ${formatLocal(draft.invited_at, timezone, 'd MMM yyyy')}`
                    : `Started ${formatLocal(draft.created_at, timezone, 'd MMM yyyy')}`}
                {' · last saved '}
                {formatLocal(draft.updated_at, timezone, 'd MMM, HH:mm')}
              </p>

              <Button
                asChild
                variant={submitted ? 'default' : 'secondary'}
                className="mt-4 w-full"
              >
                <Link href={`/org/employees/onboard/${draft.id}`}>
                  {submitted ? 'Review' : isDraft ? 'Resume' : 'Add details'}
                  <ArrowRight />
                </Link>
              </Button>
            </li>
          )
        })}
      </ul>

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this draft?</DialogTitle>
            <DialogDescription>
              Everything entered so far is discarded. No account was created, so there is nothing
              else to undo — any files already uploaded stay in your Documents library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => pending && remove(pending)}>
              Delete draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** One line saying who the card is waiting on. Nothing for a plain draft. */
function StatusLine({ status }: { status: OnboardingStatus }) {
  if (status === 'submitted') {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
        <UserCheck className="size-3" aria-hidden />
        Ready to review
      </p>
    )
  }
  if (status === 'invited') {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 self-start rounded-full bg-page px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        <Clock className="size-3" aria-hidden />
        With the employee
      </p>
    )
  }
  return null
}
