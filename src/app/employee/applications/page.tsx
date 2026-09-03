import type { Metadata } from 'next'
import Link from 'next/link'
import { BriefcaseBusiness, ExternalLink } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusChip } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { formatInstantLabel } from '@/lib/time'
import type { ApplicationStatus } from '@/types/db'

export const metadata: Metadata = { title: 'My applications' }
export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'Submitted',
  reviewing: 'Under review',
  shortlisted: 'Shortlisted',
  interviewing: 'Interviewing',
  offered: 'Offer',
  hired: 'Hired',
  rejected: 'Not progressing',
}

/**
 * Roles this employee has applied for through the portal.
 *
 * The whole page rests on one clause of `job_applications_select`:
 * `applicant_profile_id = auth.uid()`. There is no filter written below — the
 * policy is what limits this to the caller's own applications, and it is also
 * what makes the page safe to write this simply.
 *
 * WHAT THIS PAGE MUST NEVER BECOME. Their employer cannot see these rows: an
 * application carries the HIRING tenant, not the applicant's (see the privacy
 * note in 015_jobs.sql), so `tenant_id = current_tenant` never matches for a job
 * hunt elsewhere. Nothing here may be surfaced on an org-facing page, in a
 * notification, or in an audit meta field.
 *
 * `org_notes` is deliberately not selected. It is the hiring team's private
 * shorthand about a candidate, and showing someone their own file would change
 * what reviewers are willing to write in it.
 */
export default async function MyApplicationsPage() {
  await requireEmployee()
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('job_applications')
    .select('id, job_id, status, created_at, jobs(title, location, status)')
    .order('created_at', { ascending: false })

  const rows = (data ?? []) as unknown as Array<{
    id: string
    job_id: string
    status: ApplicationStatus
    created_at: string
    jobs: { title: string; location: string | null; status: string } | null
  }>

  return (
    <div className="space-y-6">
      <PageHeader
        title="My applications"
        description="Roles you have applied for on the Oneclickhr job portal. Only the hiring organization sees these — your workspace does not."
        actions={
          <Button variant="secondary" asChild>
            <Link href="/jobs">
              <ExternalLink />
              Browse jobs
            </Link>
          </Button>
        }
      />

      {rows.length ? (
        <div className="card-surface divide-y divide-line">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                {/* Only links out while the posting is still live — a dead link
                    to a withdrawn role is worse than plain text. */}
                {row.jobs && row.jobs.status === 'published' ? (
                  <Link
                    href={`/jobs/${row.job_id}`}
                    className="block truncate font-medium text-ink hover:underline"
                  >
                    {row.jobs.title}
                  </Link>
                ) : (
                  <span className="block truncate font-medium text-ink">
                    {row.jobs?.title ?? 'This role has been removed'}
                  </span>
                )}
                <p className="mt-0.5 truncate text-xs text-ink-muted">
                  Applied {formatInstantLabel(row.created_at)}
                  {row.jobs?.location ? ` · ${row.jobs.location}` : ''}
                </p>
              </div>
              {/* `shrink-0` — without it the chip is squeezed to a sliver on a
                  phone rather than the title truncating beside it. */}
              <StatusChip
                status={row.status}
                label={STATUS_LABELS[row.status]}
                className="shrink-0"
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BriefcaseBusiness}
          title="No applications yet"
          description="Roles you apply for on the job portal show up here, along with where each one has got to."
          action={
            <Button asChild>
              <Link href="/jobs">Browse open roles</Link>
            </Button>
          }
        />
      )}
    </div>
  )
}
