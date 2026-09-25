'use client'

/**
 * The job board: filters on the left, postings on the right, and the posting
 * itself in a dialog — so browsing never loses the list or its scroll.
 *
 * FILTERS LIVE IN THE URL and the server answers them, like every list in this
 * product: a filtered search is a link someone can share. Several values of one
 * filter are a comma list (`?type=c2c,w2`) and are ORed; different filters are
 * ANDed. Unknown values are dropped by the page before they reach a query.
 *
 * APPLYING NEEDS AN ACCOUNT (052). "Apply now" asks a signed-out visitor to
 * sign in (and comes back to the posting afterwards), tells an organization
 * admin that applications come from job-seeker accounts, and opens the apply
 * form for everyone else.
 */

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  BadgeCheck, Briefcase, Building2, CalendarClock, Check, Clock, Filter, Globe2, Hourglass,
  Laptop, MapPin, Search, Share2, SlidersHorizontal, Wallet, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Pagination } from '@/components/ui/pagination'
import { EmptyState } from '@/components/ui/patterns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { useProgressRouter } from '@/lib/use-progress-router'
import { cn } from '@/lib/utils'
import { formatInstantLabel } from '@/lib/time'
import { countryName } from '@/lib/geo'
import { JOB_TYPES, JOB_WORKPLACES } from '@/lib/schemas'
import {
  EXPERIENCE_BANDS, JOB_SORTS, JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS, experienceLabel,
} from '@/lib/job-form'
import { signInHref, signUpHref, type JobViewer } from '@/lib/job-viewer'
import { CompanyMark } from './company-mark'
import { JobDescription, JobSummary, RecruiterContact } from './job-details'
import { ApplyDialog } from './apply-dialog'
import type { PublicJob } from '@/types/db'

const WORKPLACE_ICON = { remote: Laptop, hybrid: Globe2, onsite: Building2 } as const

export interface BoardFilters {
  q: string
  types: string[]
  workplaces: string[]
  experience: string[]
  sort: string
}

export function JobBoard({
  jobs, total, page, perPage, filters, viewer, showFilters = true,
}: {
  jobs: PublicJob[]
  total: number
  page: number
  perPage: number
  filters: BoardFilters
  viewer: JobViewer
  showFilters?: boolean
}) {
  const [viewing, setViewing] = React.useState<PublicJob | null>(null)
  const [applying, setApplying] = React.useState<PublicJob | null>(null)
  const [promptFor, setPromptFor] = React.useState<PublicJob | null>(null)
  const [applied, setApplied] = React.useState<Set<string>>(
    () => new Set(viewer.kind === 'applicant' ? viewer.appliedJobIds : [])
  )
  const [filtersOpen, setFiltersOpen] = React.useState(false)

  React.useEffect(() => {
    if (viewer.kind === 'applicant') setApplied(new Set(viewer.appliedJobIds))
  }, [viewer])

  function apply(job: PublicJob) {
    if (viewer.kind === 'anonymous') {
      setViewing(null)
      setPromptFor(job)
      return
    }
    if (viewer.kind === 'staff') {
      toast.error('Applications are sent from a job seeker account. Sign out and sign in with one to apply.')
      return
    }
    if (applied.has(job.id)) return
    setViewing(null)
    setApplying(job)
  }

  const filtering =
    !!filters.q || filters.types.length > 0 || filters.workplaces.length > 0 || filters.experience.length > 0

  return (
    <div className={cn('grid gap-8', showFilters && 'lg:grid-cols-[280px_minmax(0,1fr)]')}>
      {showFilters ? (
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Button
            variant="secondary"
            className="w-full lg:hidden"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
          >
            <SlidersHorizontal />
            {filtersOpen ? 'Hide filters' : 'Filter positions'}
          </Button>
          <div className={cn('mt-3 lg:mt-0', !filtersOpen && 'hidden lg:block')}>
            <FilterPanel filters={filters} />
          </div>
        </aside>
      ) : null}

      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <h2 className="text-xl font-bold tracking-[-0.02em] text-ink">
            {total} {total === 1 ? 'opportunity' : 'opportunities'} found
          </h2>
          {showFilters ? <SortSelect value={filters.sort} /> : null}
        </div>

        {jobs.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                applied={applied.has(job.id)}
                onView={() => setViewing(job)}
                onApply={() => apply(job)}
              />
            ))}
          </div>
        ) : (
          <div className="card-surface">
            <EmptyState
              icon={Briefcase}
              title={filtering ? 'No roles match that' : 'No open roles here right now'}
              description={
                filtering
                  ? 'Try a broader search, or clear the filters to see everything on offer.'
                  : 'Try another country, or check back soon — new roles are posted every week.'
              }
            />
          </div>
        )}

        <Pagination page={page} perPage={perPage} total={total} />
      </div>

      <JobDetailsDialog
        job={viewing}
        applied={viewing ? applied.has(viewing.id) : false}
        onClose={() => setViewing(null)}
        onApply={apply}
      />

      <SignInPrompt job={promptFor} onClose={() => setPromptFor(null)} />

      {viewer.kind === 'applicant' ? (
        <ApplyDialog
          open={!!applying}
          job={
            applying
              ? { id: applying.id, title: applying.title, companyName: applying.company.name }
              : null
          }
          prefill={viewer.prefill}
          savedResumeName={viewer.savedResumeName}
          applicationsPath={viewer.applicationsPath}
          onClose={() => setApplying(null)}
          onApplied={(id) => setApplied((current) => new Set(current).add(id))}
        />
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ Filters */

function useQueryUpdater() {
  const router = useProgressRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  return React.useCallback(
    (mutate: (query: URLSearchParams) => void) => {
      const query = new URLSearchParams(params.toString())
      mutate(query)
      query.delete('page')
      const qs = query.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [params, pathname, router]
  )
}

function FilterPanel({ filters }: { filters: BoardFilters }) {
  const update = useQueryUpdater()
  const [q, setQ] = React.useState(filters.q)

  React.useEffect(() => setQ(filters.q), [filters.q])

  // Typing searches after a short pause rather than on every keystroke.
  React.useEffect(() => {
    if (q.trim() === filters.q) return
    const timer = window.setTimeout(() => {
      update((query) => {
        if (q.trim()) query.set('q', q.trim().slice(0, 80))
        else query.delete('q')
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [q, filters.q, update])

  function toggle(param: string, current: string[], value: string) {
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    update((query) => {
      if (next.length) query.set(param, next.join(','))
      else query.delete(param)
    })
  }

  const active =
    filters.q || filters.types.length || filters.workplaces.length || filters.experience.length

  return (
    <div className="card-surface space-y-6 p-5">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <Filter className="size-4 text-brand-600" aria-hidden />
          Filter positions
        </p>
        {active ? (
          <button
            type="button"
            onClick={() =>
              update((query) => {
                for (const key of ['q', 'type', 'mode', 'exp']) query.delete(key)
              })
            }
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
          Search
        </p>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Keyword, skill, client…"
            aria-label="Search positions"
            className="pl-9"
          />
        </div>
      </div>

      <CheckGroup
        title="Position type"
        options={JOB_TYPES.map((value) => ({ value, label: JOB_TYPE_LABELS[value] }))}
        selected={filters.types}
        onToggle={(value) => toggle('type', filters.types, value)}
      />
      <CheckGroup
        title="Work mode"
        options={JOB_WORKPLACES.map((value) => ({ value, label: JOB_WORKPLACE_LABELS[value] }))}
        selected={filters.workplaces}
        onToggle={(value) => toggle('mode', filters.workplaces, value)}
      />
      <CheckGroup
        title="Experience level"
        options={Object.entries(EXPERIENCE_BANDS).map(([value, band]) => ({ value, label: band.label }))}
        selected={filters.experience}
        onToggle={(value) => toggle('exp', filters.experience, value)}
      />
    </div>
  )
}

function CheckGroup({
  title, options, selected, onToggle,
}: {
  title: string
  options: Array<{ value: string; label: string }>
  selected: string[]
  onToggle: (value: string) => void
}) {
  return (
    <fieldset className="border-t border-line pt-5">
      <legend className="mb-3 text-sm font-semibold text-ink">{title}</legend>
      <div className="space-y-1">
        {options.map((option) => {
          const checked = selected.includes(option.value)
          return (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-ink transition hover:bg-page"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(option.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600/40',
                  checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-card'
                )}
                aria-hidden
              >
                {checked ? <Check className="size-3" strokeWidth={3} /> : null}
              </span>
              {option.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function SortSelect({ value }: { value: string }) {
  const update = useQueryUpdater()
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-ink-muted">Sort by</span>
      <Select
        value={value}
        onChange={(e) =>
          update((query) => {
            if (e.target.value === 'newest') query.delete('sort')
            else query.set('sort', e.target.value)
          })
        }
        className="w-32"
        aria-label="Sort"
      >
        {Object.entries(JOB_SORTS).map(([key, label]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </Select>
    </div>
  )
}

/* -------------------------------------------------------------------- Cards */

function JobCard({
  job, applied, onView, onApply,
}: {
  job: PublicJob
  applied: boolean
  onView: () => void
  onApply: () => void
}) {
  const experience = experienceLabel(job.experienceMin, job.experienceMax)
  const WorkIcon = WORKPLACE_ICON[job.workplace]
  const place = job.location || (job.country ? countryName(job.country) : null)

  return (
    <article className="card-surface group flex flex-col transition hover:-translate-y-0.5 hover:shadow-card">
      <div className="flex-1 p-5">
        <div className="flex items-start gap-3.5">
          <CompanyMark company={job.company} />
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[16px] font-semibold leading-snug text-ink">
              <button type="button" onClick={onView} className="text-left hover:text-brand-600">
                {job.title}
              </button>
            </h3>
            <p className="mt-0.5 truncate text-[13px] text-ink-muted">
              {job.company.name}
              {job.clientName ? ` · Client: ${job.clientName}` : ''}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            {JOB_TYPE_LABELS[job.employmentType]}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-page px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-inset ring-line">
            <WorkIcon className="size-3" aria-hidden />
            {JOB_WORKPLACE_LABELS[job.workplace]}
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-4 text-[13px]">
          {place ? <Fact icon={MapPin} value={place} /> : null}
          {experience ? <Fact icon={Briefcase} value={experience} /> : null}
          {job.duration ? <Fact icon={Hourglass} value={job.duration} /> : null}
          <Fact
            icon={Wallet}
            value={job.salaryLabel ?? 'Competitive'}
            className={job.salaryLabel ? 'font-medium text-ink' : 'font-medium text-emerald-600'}
          />
          {job.startDate ? <Fact icon={CalendarClock} value={`Start: ${job.startDate}`} /> : null}
          {job.workAuthorization ? <Fact icon={BadgeCheck} value={job.workAuthorization} /> : null}
        </dl>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-5 py-3.5">
        <span className="mr-auto inline-flex items-center gap-1.5 text-xs text-ink-muted">
          <Clock className="size-3.5" aria-hidden />
          {job.publishedAt ? formatInstantLabel(job.publishedAt) : 'Active'}
        </span>
        <Button size="sm" variant="secondary" onClick={onView}>
          View details
        </Button>
        {applied ? (
          <span className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Check className="size-3.5" aria-hidden />
            Applied
          </span>
        ) : (
          <Button size="sm" onClick={onApply}>
            Apply now
          </Button>
        )}
      </div>
    </article>
  )
}

function Fact({
  icon: Icon, value, className,
}: {
  icon: React.ComponentType<{ className?: string }>
  value: string
  className?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0 text-brand-600/80" aria-hidden />
      <span className={cn('truncate text-ink-muted', className)} title={value}>
        {value}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ Dialogs */

function JobDetailsDialog({
  job, applied, onClose, onApply,
}: {
  job: PublicJob | null
  applied: boolean
  onClose: () => void
  onApply: (job: PublicJob) => void
}) {
  async function share() {
    if (!job) return
    const url = `${window.location.origin}/jobs/${job.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: job.title, text: `${job.title} at ${job.company.name}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      // A dismissed share sheet is not an error worth telling anyone about.
    }
  }

  return (
    <Dialog open={!!job} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl">
        {job ? (
          <>
            <DialogHeader className="border-b border-line">
              <div className="flex items-start gap-4 pr-8">
                <CompanyMark company={job.company} size="lg" />
                <div className="min-w-0">
                  <DialogTitle className="text-xl">{job.title}</DialogTitle>
                  <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-ink">{job.company.name}</span>
                    {job.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden />
                        {job.location}
                      </span>
                    ) : null}
                  </DialogDescription>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
                      {JOB_TYPE_LABELS[job.employmentType]}
                    </span>
                    <span className="rounded-full bg-page px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink ring-1 ring-inset ring-line">
                      {JOB_WORKPLACE_LABELS[job.workplace]}
                    </span>
                  </div>
                </div>
              </div>
            </DialogHeader>
            <DialogBody className="py-6">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                <JobDescription job={job} />
                <div className="space-y-4">
                  <JobSummary job={job} />
                  <RecruiterContact job={job} />
                </div>
              </div>
            </DialogBody>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="secondary" onClick={share}>
                <Share2 />
                Share job
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" asChild>
                  <Link href={`/jobs/${job.id}`}>Open full page</Link>
                </Button>
                {applied ? (
                  <Button disabled>
                    <Check />
                    Applied
                  </Button>
                ) : (
                  <Button onClick={() => onApply(job)} className="min-w-40">
                    Apply now
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** "Apply now" for someone signed out: sign in, or make an account — then come back. */
export function SignInPrompt({ job, onClose }: { job: PublicJob | null; onClose: () => void }) {
  const back = job ? `/jobs/${job.id}?apply=1` : '/jobs'
  return (
    <Dialog open={!!job} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Sign in to apply</DialogTitle>
          <DialogDescription>
            {job ? `Applying for ${job.title} at ${job.company.name}. ` : ''}
            A free job seeker account lets you apply in a click and follow every application.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-2">
          <div className="grid gap-2">
            <Button asChild>
              <Link href={signInHref(back)}>Sign in</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href={signUpHref(back)}>Create a free account</Link>
            </Button>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            <X />
            Not now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
