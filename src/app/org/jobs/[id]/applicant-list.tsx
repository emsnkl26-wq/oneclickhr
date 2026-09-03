'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Users, Download, Mail, Phone, Linkedin, Globe, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Select, Textarea } from '@/components/ui/input'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatInstantLabel } from '@/lib/time'
import { APPLICATION_STATUSES } from '@/lib/schemas'
import { cn, initials } from '@/lib/utils'
import type { ApplicationStatus } from '@/types/db'

export interface ApplicantRow {
  id: string
  fullName: string
  email: string
  phone: string | null
  location: string | null
  linkedinUrl: string | null
  portfolioUrl: string | null
  coverLetter: string | null
  hasResume: boolean
  yearsExperience: number | null
  currentCompany: string | null
  noticePeriod: string | null
  source: 'public' | 'internal'
  status: ApplicationStatus
  orgNotes: string | null
  createdAt: string
}

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  shortlisted: 'Shortlisted',
  interviewing: 'Interviewing',
  offered: 'Offered',
  hired: 'Hired',
  rejected: 'Rejected',
}

/**
 * The applicant inbox, as an expandable list rather than a table.
 *
 * A DataTable is right for rows you scan and wrong for rows you READ. An
 * application is a cover letter, a CV and a note — a table would truncate all
 * three into columns nobody can judge a person from, and reviewing would mean
 * opening a detail page per candidate and losing your place in the queue.
 *
 * Filtering happens HERE rather than in the URL, unlike every list page in the
 * app. The difference is that this is one job's applicants — tens, not
 * thousands — and they are already on the page. A round trip to hide four rows
 * would cost a reviewer their scroll position and their expanded card for no
 * gain. The lists that filter server-side do so because they are paginated.
 */
export function ApplicantList({
  applications,
  initialOpenId,
  endpoint = '/api/org/jobs/applications',
}: {
  applications: ApplicantRow[]
  initialOpenId?: string
  /**
   * Where a status change or note is PATCHed.
   *
   * The platform console passes `/api/super/jobs/applications` instead — an
   * `/api/org/` route refuses a super admin outright, and the two endpoints
   * enforce different rules about whose applicants may be touched at all. Same
   * component, different authority behind it.
   */
  endpoint?: string
}) {
  const router = useRouter()
  const [filter, setFilter] = React.useState<'all' | ApplicationStatus>('all')
  const [openId, setOpenId] = React.useState<string | null>(initialOpenId ?? null)
  const [busyId, setBusyId] = React.useState<string | null>(null)
  const [notes, setNotes] = React.useState<Record<string, string>>({})

  const visible =
    filter === 'all' ? applications : applications.filter((row) => row.status === filter)

  async function save(row: ApplicantRow, patch: { status?: ApplicationStatus; notes?: string }) {
    setBusyId(row.id)
    try {
      await apiPatch(`${endpoint}/${row.id}`, patch)
      toast.success(patch.status ? `Moved to ${STATUS_LABELS[patch.status]}` : 'Note saved')
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.'
      )
    } finally {
      setBusyId(null)
    }
  }

  if (!applications.length) {
    return (
      <EmptyState
        icon={Users}
        title="No applications yet"
        description="Applications from the public job portal land here. Share the posting to get things moving."
      />
    )
  }

  return (
    <div className="space-y-4">
      {/*
        * A LOCAL tab strip, not LinkTabs.
        *
        * LinkTabs writes the URL, and every list page in this app uses it for
        * exactly that reason. Here it would be wrong: navigating remounts this
        * component, which closes whichever application the reviewer had open and
        * throws away the note they were part-way through typing. Same pixels,
        * different mechanism, and the difference is the reviewer's place in the
        * queue.
        */}
      <div
        role="tablist"
        className="no-scrollbar inline-flex items-center gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1"
      >
        {(
          [
            { value: 'all' as const, label: 'All', count: applications.length },
            ...APPLICATION_STATUSES.filter((status) =>
              applications.some((row) => row.status === status)
            ).map((status) => ({
              value: status,
              label: STATUS_LABELS[status],
              count: applications.filter((row) => row.status === status).length,
            })),
          ]
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={filter === tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              'focus-ring flex items-center whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
              filter === tab.value ? 'bg-brand-50 text-brand-700' : 'text-ink-muted hover:text-ink'
            )}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {visible.map((row) => {
          const expanded = openId === row.id
          return (
            <div key={row.id} className="card-surface overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenId(expanded ? null : row.id)}
                aria-expanded={expanded}
                className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-page/60"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-page text-xs font-semibold text-ink-muted">
                  {initials(row.fullName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-ink">{row.fullName}</span>
                    {/* `shrink-0` or the flex row squeezes the badge to nothing
                        before it truncates the name beside it. */}
                    {row.source === 'internal' ? (
                      <span className="hidden shrink-0 rounded-full bg-page px-2 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-inset ring-line sm:inline">
                        On the platform
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-ink-muted">
                    {[
                      row.currentCompany,
                      row.yearsExperience !== null ? `${row.yearsExperience} yrs` : null,
                      row.location,
                    ]
                      .filter(Boolean)
                      .join(' · ') || row.email}
                  </span>
                </span>
                {/*
                  * The date drops out below `sm`. On a phone this row already
                  * carries an avatar, a name, a sub-line and a status chip; the
                  * date is the least useful of them and squeezing it in is what
                  * pushed the chip off the edge. It stays available in the
                  * expanded card's own header for anyone who needs it.
                  */}
                <span className="hidden shrink-0 text-xs text-ink-muted sm:block">
                  {formatInstantLabel(row.createdAt)}
                </span>
                <StatusChip status={row.status} label={STATUS_LABELS[row.status]} />
              </button>

              {expanded ? (
                <div className="space-y-4 border-t border-line px-4 py-4">
                  {/* Carries the date the header hides on a phone. */}
                  <p className="text-xs text-ink-muted sm:hidden">
                    Applied {formatInstantLabel(row.createdAt)}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 break-all text-sm">
                    <a
                      href={`mailto:${row.email}`}
                      className="inline-flex items-center gap-1.5 text-brand-600 hover:underline"
                    >
                      <Mail className="size-3.5" aria-hidden />
                      {row.email}
                    </a>
                    {row.phone ? (
                      <a
                        href={`tel:${row.phone}`}
                        className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"
                      >
                        <Phone className="size-3.5" aria-hidden />
                        {row.phone}
                      </a>
                    ) : null}
                    {/*
                      * Applicant-supplied links open with `noopener noreferrer`
                      * and no `target="_blank"` trust: these URLs come from an
                      * anonymous form, and the schema already refuses anything
                      * that is not http(s).
                      */}
                    {row.linkedinUrl ? (
                      <a
                        href={row.linkedinUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"
                      >
                        <Linkedin className="size-3.5" aria-hidden />
                        LinkedIn
                      </a>
                    ) : null}
                    {row.portfolioUrl ? (
                      <a
                        href={row.portfolioUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink"
                      >
                        <Globe className="size-3.5" aria-hidden />
                        Portfolio
                      </a>
                    ) : null}
                    {row.noticePeriod ? (
                      <span className="inline-flex items-center gap-1.5 text-ink-muted">
                        <Building2 className="size-3.5" aria-hidden />
                        Notice: {row.noticePeriod}
                      </span>
                    ) : null}
                  </div>

                  {row.coverLetter ? (
                    <div className="rounded-lg bg-page p-3.5">
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                        Cover note
                      </p>
                      {/* Plain text, never markup — this is a stranger's input. */}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                        {row.coverLetter}
                      </p>
                    </div>
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label
                        htmlFor={`status-${row.id}`}
                        className="block text-xs font-semibold uppercase tracking-wide text-ink-muted"
                      >
                        Stage
                      </label>
                      <Select
                        id={`status-${row.id}`}
                        value={row.status}
                        disabled={busyId === row.id}
                        onChange={(e) => save(row, { status: e.target.value as ApplicationStatus })}
                      >
                        {APPLICATION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ))}
                      </Select>
                      {row.hasResume ? (
                        <Button variant="secondary" className="w-full" asChild>
                          <a href={`/api/org/jobs/applications/${row.id}/resume`}>
                            <Download />
                            Download CV
                          </a>
                        </Button>
                      ) : (
                        <p className="text-xs text-ink-muted">No CV attached.</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label
                        htmlFor={`notes-${row.id}`}
                        className="block text-xs font-semibold uppercase tracking-wide text-ink-muted"
                      >
                        Private notes
                      </label>
                      <Textarea
                        id={`notes-${row.id}`}
                        rows={3}
                        defaultValue={row.orgNotes ?? ''}
                        onChange={(e) =>
                          setNotes((current) => ({ ...current, [row.id]: e.target.value }))
                        }
                        placeholder="Only your team sees this."
                      />
                      <Button
                        variant="secondary"
                        loading={busyId === row.id}
                        disabled={notes[row.id] === undefined}
                        onClick={() => save(row, { notes: notes[row.id] ?? '' })}
                      >
                        Save note
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {!visible.length ? (
        <p className={cn('py-6 text-center text-sm text-ink-muted')}>
          Nobody is at that stage yet.
        </p>
      ) : null}
    </div>
  )
}
