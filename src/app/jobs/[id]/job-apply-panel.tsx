'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Check, Share2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ApplyDialog } from '../apply-dialog'
import { SignInPrompt } from '../job-board'
import type { JobViewer } from '@/lib/job-viewer'
import type { PublicJob } from '@/types/db'

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
        <div className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <Check className="size-4" aria-hidden />
          You applied
          {viewer.kind === 'applicant' ? (
            <Link href={viewer.applicationsPath} className="ml-1 underline">
              Track it
            </Link>
          ) : null}
        </div>
      ) : (
        <Button className="flex-1" onClick={apply}>
          Apply now
        </Button>
      )}

      <SignInPrompt job={prompt ? job : null} onClose={() => setPrompt(false)} />

      {viewer.kind === 'applicant' ? (
        <ApplyDialog
          open={applying}
          job={{ id: job.id, title: job.title, companyName: job.company.name }}
          prefill={viewer.prefill}
          savedResumeName={viewer.savedResumeName}
          applicationsPath={viewer.applicationsPath}
          onClose={() => setApplying(false)}
          onApplied={() => setApplied(true)}
        />
      ) : null}
    </div>
  )
}
