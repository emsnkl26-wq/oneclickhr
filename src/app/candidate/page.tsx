import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BriefcaseBusiness, ChevronDown, ExternalLink, Linkedin, Mail, MapPin, Phone, UserRound,
} from 'lucide-react'
import { requireCandidate } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusChip } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { formatInstantLabel } from '@/lib/time'
import { APPLICATION_STATUS_LABELS, JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS } from '@/lib/job-form'
import { cn } from '@/lib/utils'
import type { ApplicationStatus, JobType, JobWorkplace } from '@/types/db'

export const metadata: Metadata = { title: 'My applications' }
export const dynamic = 'force-dynamic'

interface ApplicationRow {
  id: string
  job_id: string
  status: ApplicationStatus
  candidate_message: string | null
  created_at: string
  updated_at: string
  resume_name: string | null
  job_title: string
  job_status: string
  job_location: string | null
  employment_type: JobType
  workplace: JobWorkplace
  company_name: string
  recruiter_name: string | null
  recruiter_title: string | null
  recruiter_email: string | null
  recruiter_phone: string | null
  recruiter_linkedin_url: string | null
}

interface EventRow {
  application_id: string
  status: ApplicationStatus
  message: string | null
  created_at: string
}

/** The stages an application moves through, in order — for the progress bar. */
const PIPELINE: ApplicationStatus[] = ['new', 'reviewing', 'shortlisted', 'interviewing', 'offered', 'hired']

/**
 * Every application this job seeker has sent, and where each one stands.
 *
 * `my_job_applications()` (052) returns ONLY the caller's own applications with
 * the public facts of each job; `job_application_events` is limited to the
 * same rows by its policy. The hiring team's private notes are in neither.
 */
export default async function CandidateApplicationsPage() {
  const ctx = await requireCandidate()
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase.rpc('my_job_applications')
  const rows = (data ?? []) as ApplicationRow[]

  const { data: events } = rows.length
    ? await supabase
        .from('job_application_events')
        .select('application_id, status, message, created_at')
        .in('application_id', rows.map((r) => r.id))
        .order('created_at', { ascending: true })
        .limit(2000)
    : { data: [] }

  const timeline = new Map<string, EventRow[]>()
  for (const event of (events ?? []) as EventRow[]) {
    const list = timeline.get(event.application_id)
    if (list) list.push(event)
    else timeline.set(event.application_id, [event])
  }

  const active = rows.filter((r) => r.status !== 'rejected' && r.status !== 'hired').length

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome${ctx.fullName ? `, ${ctx.fullName.split(' ')[0]}` : ''}`}
        description={
          rows.length
            ? `${rows.length} application${rows.length === 1 ? '' : 's'} sent · ${active} in progress`
            : 'Apply to roles on the job board and follow every application here.'
        }
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/candidate/profile">
                <UserRound />
                My profile
              </Link>
            </Button>
            <Button asChild>
              <Link href="/jobs">
                <BriefcaseBusiness />
                Browse jobs
              </Link>
            </Button>
          </>
        }
      />

      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <ApplicationCard row={row} events={timeline.get(row.id) ?? []} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="card-surface">
          <EmptyState
            icon={BriefcaseBusiness}
            title="No applications yet"
            description="When you apply for a role it shows up here, with every update from the hiring team."
            action={
              <Button asChild>
                <Link href="/jobs">Find your next role</Link>
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}

function ApplicationCard({ row, events }: { row: ApplicationRow; events: EventRow[] }) {
  const live = row.job_status === 'published'
  const stage = PIPELINE.indexOf(row.status)
  const latestMessage = [...events].reverse().find((e) => e.message)?.message ?? null

  return (
    <details className="card-surface group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-4 p-5 [&::-webkit-details-marker]:hidden">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-base font-bold text-brand-ink">
          {row.company_name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{row.job_title}</span>
          <span className="mt-0.5 block truncate text-[13px] text-ink-muted">
            {row.company_name} · Applied {formatInstantLabel(row.created_at)}
            {!live ? ' · Posting closed' : ''}
          </span>
        </span>
        <StatusChip
          status={row.status}
          label={APPLICATION_STATUS_LABELS[row.status]}
          className="shrink-0"
        />
        <ChevronDown
          className="size-4 shrink-0 text-ink-muted transition group-open:rotate-180"
          aria-hidden
        />
      </summary>

      <div className="space-y-5 border-t border-line p-5">
        {/* Progress through the pipeline — a rejection stops it where it was. */}
        {row.status !== 'rejected' ? (
          <ol className="grid grid-cols-6 gap-1.5" aria-label="Progress">
            {PIPELINE.map((step, index) => (
              <li key={step} className="space-y-1.5">
                <span
                  className={cn(
                    'block h-1.5 rounded-full',
                    index <= stage ? 'bg-brand-600' : 'bg-line'
                  )}
                />
                <span
                  className={cn(
                    'block truncate text-[11px]',
                    index === stage ? 'font-semibold text-ink' : 'text-ink-muted'
                  )}
                >
                  {APPLICATION_STATUS_LABELS[step]}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg bg-page px-4 py-3 text-sm text-ink-muted">
            The hiring team decided not to take this application further. Thank you for applying —
            there may be something else that suits you.
          </p>
        )}

        {latestMessage ? (
          <div className="rounded-lg border border-brand-200 bg-brand-50/60 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink">
              Message from {row.company_name}
            </p>
            <p className="mt-1 whitespace-pre-line break-words text-sm text-ink">{latestMessage}</p>
          </div>
        ) : null}

        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Updates</p>
            <ol className="mt-3 space-y-3 border-l border-line pl-4">
              {events.map((event, index) => (
                <li key={`${event.created_at}-${index}`} className="relative">
                  <span
                    className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-card bg-brand-600"
                    aria-hidden
                  />
                  <p className="text-sm font-medium text-ink">
                    {APPLICATION_STATUS_LABELS[event.status]}
                  </p>
                  <p className="text-xs text-ink-muted">{formatInstantLabel(event.created_at)}</p>
                  {event.message ? (
                    <p className="mt-1 whitespace-pre-line break-words text-[13px] text-ink-muted">
                      {event.message}
                    </p>
                  ) : null}
                </li>
              ))}
              {!events.length ? <li className="text-sm text-ink-muted">Received.</li> : null}
            </ol>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">The role</p>
            <p className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-page px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-line">
                {JOB_TYPE_LABELS[row.employment_type] ?? row.employment_type}
              </span>
              <span className="rounded-full bg-page px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-line">
                {JOB_WORKPLACE_LABELS[row.workplace] ?? row.workplace}
              </span>
            </p>
            {row.job_location ? (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <MapPin className="size-4" aria-hidden />
                {row.job_location}
              </p>
            ) : null}
            {row.resume_name ? (
              <p className="text-sm text-ink-muted">CV sent: {row.resume_name}</p>
            ) : null}
            {row.recruiter_name || row.recruiter_email || row.recruiter_phone ? (
              <div className="space-y-1.5 rounded-lg bg-page px-4 py-3 text-sm">
                <p className="font-medium text-ink">
                  {row.recruiter_name ?? 'Recruiter'}
                  {row.recruiter_title ? (
                    <span className="font-normal text-ink-muted"> · {row.recruiter_title}</span>
                  ) : null}
                </p>
                {row.recruiter_email ? (
                  <a href={`mailto:${row.recruiter_email}`} className="flex items-center gap-2 break-all text-ink-muted hover:text-brand-ink">
                    <Mail className="size-4 shrink-0" aria-hidden />
                    {row.recruiter_email}
                  </a>
                ) : null}
                {row.recruiter_phone ? (
                  <a href={`tel:${row.recruiter_phone.replace(/[^+\d]/g, '')}`} className="flex items-center gap-2 text-ink-muted hover:text-brand-ink">
                    <Phone className="size-4 shrink-0" aria-hidden />
                    {row.recruiter_phone}
                  </a>
                ) : null}
                {row.recruiter_linkedin_url && /^https:\/\//i.test(row.recruiter_linkedin_url) ? (
                  <a
                    href={row.recruiter_linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="flex items-center gap-2 text-ink-muted hover:text-brand-ink"
                  >
                    <Linkedin className="size-4 shrink-0" aria-hidden />
                    LinkedIn
                  </a>
                ) : null}
              </div>
            ) : null}
            {live ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/jobs/${row.job_id}`}>
                  <ExternalLink />
                  View posting
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </details>
  )
}
