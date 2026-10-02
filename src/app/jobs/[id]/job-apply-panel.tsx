'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, Share2, X as XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody,
} from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { ApplyDialog } from '../apply-dialog'
import { SignInPrompt } from '../job-board'
import type { JobViewer } from '@/lib/job-viewer'
import type { ApplicationStatus, PublicJob } from '@/types/db'

/**
 * The posting page's call to action (052).
 *
 * `?apply=1` — where sign-in returns someone who pressed "Apply now" while
 * signed out — opens the form straight away, and is then dropped from the URL
 * so a refresh does not reopen it.
 */
export function JobApplyPanel({
  job, viewer, closed,
}: {
  job: PublicJob
  viewer: JobViewer
  closed: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [applying, setApplying] = React.useState(false)
  const [prompt, setPrompt] = React.useState(false)
  const [tracking, setTracking] = React.useState(false)
  const application = viewer.kind === 'applicant' ? viewer.applications[job.id] : undefined
  const [applied, setApplied] = React.useState(
    viewer.kind === 'applicant' && viewer.appliedJobIds.includes(job.id)
  )

  const apply = React.useCallback(() => {
    if (viewer.kind === 'anonymous') return setPrompt(true)
    if (viewer.kind === 'staff') {
      toast.error('Applications are sent from a job seeker account. Sign in with one to apply.')
      return
    }
    setApplying(true)
  }, [viewer.kind])

  React.useEffect(() => {
    if (params.get('apply') !== '1') return
    router.replace(pathname, { scroll: false })
    if (!closed && !applied) apply()
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function share() {
    const url = `${window.location.origin}/jobs/${job.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: job.title, text: `${job.title} at ${job.company.name}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      // A dismissed share sheet is not an error.
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button variant="secondary" onClick={share}>
        <Share2 />
        Share job
      </Button>
      {closed ? (
        <Button disabled className="flex-1">
          Applications closed
        </Button>
      ) : applied ? (
        <div className="flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Check className="size-4" aria-hidden />
          You applied
          {viewer.kind === 'applicant' ? (
            <button type="button" onClick={() => setTracking(true)} className="ml-1 underline">
              Track it
            </button>
          ) : null}
        </div>
      ) : (
        <Button className="flex-1" onClick={apply}>
          Apply now
        </Button>
      )}

      {viewer.kind === 'applicant' ? (
        <Dialog open={tracking} onOpenChange={setTracking}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Your application</DialogTitle>
              <DialogDescription>
                {job.title} at {job.company.name}
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ApplicationTracker
                status={application?.status ?? 'new'}
                appliedAt={application?.appliedAt ?? null}
                updatedAt={application?.updatedAt ?? null}
              />
              <Link
                href={viewer.applicationsPath}
                className="mt-5 inline-block text-sm font-medium text-brand-600 hover:underline"
              >
                See all my applications
              </Link>
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}

      <SignInPrompt job={prompt ? job : null} onClose={() => setPrompt(false)} />

      {viewer.kind === 'applicant' ? (
        <ApplyDialog
          open={applying}
          job={{ id: job.id, title: job.title, companyName: job.company.name }}
          prefill={viewer.prefill}
          savedResumeName={viewer.savedResumeName}
          applicationsPath={viewer.applicationsPath}
          onClose={() => setApplying(false)}
          onApplied={() => {
            setApplied(true)
            router.refresh()
          }}
        />
      ) : null}
    </div>
  )
}

const STAGES: { status: ApplicationStatus; label: string; hint: string }[] = [
  { status: 'new', label: 'Submitted', hint: 'The hiring team has your application.' },
  { status: 'reviewing', label: 'Under review', hint: 'Someone is looking at your profile.' },
  { status: 'shortlisted', label: 'Shortlisted', hint: 'You made the shortlist.' },
  { status: 'interviewing', label: 'Interviewing', hint: 'Expect to hear about interview slots.' },
  { status: 'offered', label: 'Offer', hint: 'An offer has been made.' },
  { status: 'hired', label: 'Hired', hint: 'Congratulations!' },
]

function ApplicationTracker({
  status, appliedAt, updatedAt,
}: {
  status: ApplicationStatus
  appliedAt: string | null
  updatedAt: string | null
}) {
  const rejected = status === 'rejected'
  const current = rejected ? -1 : STAGES.findIndex((stage) => stage.status === status)
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null

  return (
    <div>
      {rejected ? (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-line bg-page p-3 text-sm">
          <XIcon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
          <div>
            <p className="font-semibold text-ink">Not progressing</p>
            <p className="text-ink-muted">
              The team decided not to move forward this time{fmt(updatedAt) ? ` (${fmt(updatedAt)})` : ''}.
            </p>
          </div>
        </div>
      ) : null}
      <ol className="space-y-0">
        {STAGES.map((stage, index) => {
          const done = !rejected && index < current
          const active = !rejected && index === current
          const last = index === STAGES.length - 1
          return (
            <li key={stage.status} className="relative flex gap-3 pb-5 last:pb-0">
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-0.5',
                    done ? 'bg-brand-500' : 'bg-line'
                  )}
                />
              ) : null}
              <span
                className={cn(
                  'relative z-10 grid size-6 shrink-0 place-items-center rounded-full border-2 text-[11px] font-bold',
                  done && 'border-brand-500 bg-brand-500 text-white',
                  active && 'border-brand-500 bg-card text-brand-600 ring-4 ring-brand-500/15',
                  !done && !active && 'border-line bg-card text-ink-muted'
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={cn('text-sm font-semibold', active || done ? 'text-ink' : 'text-ink-muted')}>
                  {stage.label}
                  {active ? <span className="ml-2 text-xs font-medium text-brand-600">Current</span> : null}
                </p>
                {active ? <p className="text-xs text-ink-muted">{stage.hint}</p> : null}
                {index === 0 && fmt(appliedAt) ? (
                  <p className="text-xs text-ink-muted">Applied {fmt(appliedAt)}</p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
