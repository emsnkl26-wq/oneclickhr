'use client'

import * as React from 'react'
import Link from 'next/link'
import { Briefcase, FileText, Linkedin, Mail, MapPin, Phone, Search, Sparkles, UserSearch } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { apiPost, ApiClientError } from '@/lib/fetcher'

interface MatchResult {
  key: string
  fullName: string | null
  email: string | null
  phone: string | null
  location: string | null
  headline: string | null
  currentCompany: string | null
  noticePeriod: string | null
  workAuthorization: string | null
  linkedinUrl: string | null
  skills: string[]
  hasResume: boolean
  origin: 'seeker' | 'applicant' | 'both'
  profileId: string | null
  applications: Array<{ id: string; jobId: string; jobTitle: string; status: string; appliedAt: string }>
  score: number
  matched: string[]
  years: { candidate: number | null; required: number | null; short: boolean }
}

interface MatchResponse {
  results: MatchResult[]
  terms: string[]
  minYears: number | null
  searched: number
  matched: number
}

/**
 * "Who should I call about this role?"
 *
 * The jobs portal is where the business actually earns, and this is the screen
 * that turns a requirement into a call list: paste the description, get people
 * in order, with the reason for the order printed next to each one.
 *
 * THE MATCHED TERMS ARE NOT DECORATION. A ranking a recruiter cannot audit is a
 * ranking they will stop trusting the first time it is wrong, and they will be
 * right to. Every row shows which words put it there, and the header shows what
 * the whole search was run on — so a bad result reads as "it keyed on the wrong
 * word" instead of "the tool is useless".
 *
 * Results are not in the URL. A pasted job description is thousands of
 * characters and does not belong in a query string, so this posts and renders
 * what comes back; `initial` is for arriving from a posting we already have.
 */
export function MatchConsole({
  initialTitle = '',
  initialDescription = '',
  initialMinYears = '',
  fromJob = null,
}: {
  initialTitle?: string
  initialDescription?: string
  initialMinYears?: string
  /** The posting these fields were prefilled from, if any. */
  fromJob?: { id: string; title: string } | null
}) {
  const [title, setTitle] = React.useState(initialTitle)
  const [description, setDescription] = React.useState(initialDescription)
  const [minYears, setMinYears] = React.useState(initialMinYears)
  const [seekers, setSeekers] = React.useState(true)
  const [applicants, setApplicants] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [data, setData] = React.useState<MatchResponse | null>(null)

  const sources = [...(seekers ? ['seekers'] : []), ...(applicants ? ['applicants'] : [])]
  const canSearch = !!(title.trim() || description.trim()) && sources.length > 0 && !busy

  async function search(event?: React.FormEvent) {
    event?.preventDefault()
    if (!canSearch) return
    setBusy(true)
    try {
      const parsed = Number.parseInt(minYears, 10)
      const response = await apiPost<MatchResponse>('/api/super/candidate-match', {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        minYears: Number.isInteger(parsed) && parsed >= 0 ? parsed : null,
        sources,
      })
      setData(response)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That search could not be run')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-ink-muted" aria-hidden />
            What are you hiring for?
          </CardTitle>
          <CardDescription>
            A role title is enough for a quick look. Paste the whole description for a better
            order — the title counts for three times as much as the body, so both together are
            the most accurate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={search} className="space-y-4">
            {fromJob ? (
              <p className="rounded-lg border border-line bg-page px-3.5 py-2.5 text-[13px] text-ink-muted">
                Prefilled from{' '}
                <Link
                  href={`/super/jobs/${fromJob.id}`}
                  className="font-medium text-brand-ink hover:underline"
                >
                  {fromJob.title}
                </Link>
                . Edit anything below — nothing here changes the posting.
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <FormField label="Role" htmlFor="match-title">
                <Input
                  id="match-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Senior Salesforce Developer"
                  autoFocus
                />
              </FormField>
              <FormField
                label="Minimum years"
                htmlFor="match-years"
                hint="Read from the description when left blank"
              >
                <Input
                  id="match-years"
                  type="number"
                  min={0}
                  max={40}
                  value={minYears}
                  onChange={(event) => setMinYears(event.target.value)}
                  className="sm:w-36"
                />
              </FormField>
            </div>

            <FormField label="Job description" htmlFor="match-jd">
              <Textarea
                id="match-jd"
                rows={8}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Paste the requirement — responsibilities, must-have skills, stack, work authorization…"
              />
            </FormField>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={seekers}
                  onChange={(event) => setSeekers(event.target.checked)}
                  className="size-4 rounded border-line"
                />
                Job seekers on the portal
              </label>
              <label className="flex items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  checked={applicants}
                  onChange={(event) => setApplicants(event.target.checked)}
                  className="size-4 rounded border-line"
                />
                People who applied to our roles
              </label>
              <Button type="submit" loading={busy} disabled={!canSearch} className="ml-auto">
                <Search />
                Find candidates
              </Button>
            </div>
            {/*
              Said once, here, rather than in a footnote nobody reads: this
              searches OUR people only. A customer's applicants belong to that
              customer, and /super/jobs/[id] refuses to show them for the same
              reason.
            */}
            <p className="text-xs leading-relaxed text-ink-muted">
              Searches our own talent pool only — job seekers who signed up on the portal, and
              people who applied to a OneclickHR posting. Applicants to a customer&apos;s job
              belong to that customer and are never included.
            </p>
          </form>
        </CardContent>
      </Card>

      {data ? <Results data={data} /> : null}
    </div>
  )
}

function Results({ data }: { data: MatchResponse }) {
  if (!data.results.length) {
    return (
      <EmptyState
        icon={UserSearch}
        title="Nobody matched"
        description={
          data.searched === 0
            ? 'There is nobody in the pools you searched yet.'
            : `None of the ${data.searched} people we searched had anything in common with this role. Try a shorter description, or just the role title.`
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          {data.matched} {data.matched === 1 ? 'match' : 'matches'}
          {data.matched > data.results.length ? ` · best ${data.results.length} shown` : ''}
        </h2>
        <p className="text-xs text-ink-muted">
          from {data.searched} people
          {data.minYears !== null ? ` · ${data.minYears}+ years asked for` : ''}
        </p>
      </div>

      {/* What the ranking actually keyed on. The check a recruiter makes before
          trusting the order — and the fastest way to spot a description that
          was pasted with its header and footer still attached. */}
      <p className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-page px-3.5 py-2.5 text-xs text-ink-muted">
        <span className="font-medium text-ink">Ranked on:</span>
        {data.terms.map((term) => (
          <code key={term} className="rounded bg-card px-1.5 py-0.5 font-mono text-[11px]">
            {term}
          </code>
        ))}
      </p>

      <ul className="space-y-3">
        {data.results.map((row) => (
          <MatchCard key={row.key} row={row} />
        ))}
      </ul>
    </div>
  )
}

/** Green at 60, amber at 30, grey below — three bands, so a glance sorts them. */
function scoreTone(score: number): string {
  if (score >= 60) return 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  if (score >= 30) return 'bg-amber-50 text-amber-700 ring-amber-200'
  return 'bg-page text-ink-muted ring-line'
}

function MatchCard({ row }: { row: MatchResult }) {
  const name = row.fullName?.trim() || row.email || 'Unnamed'

  return (
    <li className="card-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={`grid size-12 shrink-0 place-items-center rounded-xl text-[15px] font-bold tabular ring-1 ring-inset ${scoreTone(
            row.score
          )}`}
          aria-label={`${row.score} percent match`}
        >
          {row.score}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {row.profileId ? (
              <Link
                href={`/super/talent/${row.profileId}`}
                className="truncate text-[15px] font-semibold hover:text-brand-ink hover:underline"
              >
                {name}
              </Link>
            ) : (
              <span className="truncate text-[15px] font-semibold">{name}</span>
            )}
            {row.origin === 'both' ? (
              <StatusChip status="info" tone="info" label="Signed up · applied to us" />
            ) : row.origin === 'applicant' ? (
              <StatusChip status="info" tone="info" label="Applied to us" />
            ) : (
              <StatusChip status="neutral" tone="neutral" label="On the portal" />
            )}
            {row.years.short ? (
              <StatusChip
                status="pending"
                tone="warning"
                label={`${row.years.candidate} yrs — ${row.years.required} asked for`}
              />
            ) : row.years.candidate !== null ? (
              <StatusChip status="neutral" tone="neutral" label={`${row.years.candidate} yrs`} />
            ) : null}
          </div>

          {row.headline || row.currentCompany ? (
            <p className="mt-0.5 truncate text-[13px] text-ink-muted">
              {[row.headline, row.currentCompany].filter(Boolean).join(' · ')}
            </p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            {row.email ? (
              <a href={`mailto:${row.email}`} className="flex items-center gap-1.5 hover:text-brand-ink">
                <Mail className="size-3.5" aria-hidden />
                {row.email}
              </a>
            ) : null}
            {row.phone ? (
              <a href={`tel:${row.phone}`} className="flex items-center gap-1.5 hover:text-brand-ink">
                <Phone className="size-3.5" aria-hidden />
                {row.phone}
              </a>
            ) : null}
            {row.location ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden />
                {row.location}
              </span>
            ) : null}
            {row.linkedinUrl ? (
              <a
                href={row.linkedinUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 hover:text-brand-ink"
              >
                <Linkedin className="size-3.5" aria-hidden />
                LinkedIn
              </a>
            ) : null}
            {row.hasResume ? (
              <span className="flex items-center gap-1.5">
                <FileText className="size-3.5" aria-hidden />
                Résumé on file
              </span>
            ) : null}
            {row.workAuthorization ? <span>{row.workAuthorization}</span> : null}
            {row.noticePeriod ? <span>Notice: {row.noticePeriod}</span> : null}
          </div>

          {/* The reason this person is where they are in the list. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-muted">Matched</span>
            {row.matched.map((term) => (
              <code
                key={term}
                className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] text-emerald-800 ring-1 ring-inset ring-emerald-200"
              >
                {term}
              </code>
            ))}
          </div>

          {row.applications.length ? (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-muted">
              <Briefcase className="size-3.5 shrink-0" aria-hidden />
              Applied to{' '}
              {row.applications.map((application, index) => (
                <React.Fragment key={application.id}>
                  {index ? <span>·</span> : null}
                  <Link
                    href={`/super/jobs/${application.jobId}?application=${application.id}`}
                    className="font-medium text-brand-ink hover:underline"
                  >
                    {application.jobTitle}
                  </Link>
                  <StatusChip status={application.status} />
                </React.Fragment>
              ))}
            </p>
          ) : null}

          {row.skills.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.skills.slice(0, 14).map((skill) => (
                <span
                  key={skill}
                  className="rounded-full bg-page px-2 py-0.5 text-[11px] font-medium text-ink ring-1 ring-inset ring-line"
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}
