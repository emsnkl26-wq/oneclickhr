'use client'

/**
 * The job board: filters on the left, postings on the right, and the posting
 * itself in a dialog — so browsing never loses the list or its scroll.
 *
 * FILTERS LIVE IN THE URL and the server answers them, like every list in this
 * product: a filtered search is a link someone can share. Several values of one
 * filter are a comma list (`?type=c2c,w2`) and are ORed; different filters are
 * ANDed. Unknown values are dropped before they reach a query.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW A FILTER CLICK IS SERVED (057)
 * ───────────────────────────────────────────────────────────────────────────
 * The FIRST paint is server-rendered by page.tsx, for the exact URL that was
 * asked for. That is what a crawler, a shared link and a visitor with no
 * JavaScript get, and it has not changed.
 *
 * Every click AFTER that is handled here, because the alternative was a full
 * navigation: Next re-ran the whole page — country list, feed, companies,
 * viewer — and shipped a new payload for the hero, the sidebar, the header and
 * the footer, in order to change which twenty cards are on screen.
 *
 * So, with `liveFilters`:
 *   1. the URL is updated with `history.replaceState`, which keeps the address
 *      bar honest and shareable WITHOUT asking Next to re-render the route;
 *   2. the rows are fetched from `/api/jobs/feed`, which returns card fields
 *      only and is cacheable by the CDN because it reads no session;
 *   3. the answer is kept in `feedCache`, so going back to a filter combination
 *      — which is most of what filtering is — repaints with no request at all;
 *   4. the list shows a skeleton the instant a filter changes, rather than
 *      standing there looking clicked-but-dead.
 *
 * Without `liveFilters` (the company page, which has no filter panel) nothing
 * below runs and navigation behaves exactly as it always did.
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
import type { PublicJob, PublicJobCard } from '@/types/db'

const WORKPLACE_ICON = { remote: Laptop, hybrid: Globe2, onsite: Building2 } as const

export interface BoardFilters {
  q: string
  types: string[]
  workplaces: string[]
  experience: string[]
  sort: string
}

interface FeedState {
  jobs: PublicJobCard[]
  total: number
  page: number
}

/* ------------------------------------------------------------------- Caches */

/**
 * Filter combinations this visitor has already seen, keyed by query string.
 *
 * Module scope, so it survives a client navigation to a posting and back, which
 * is the single most common thing anyone does on this page. Entries expire
 * after `CACHE_TTL` — the same window the server's own cache uses — so a role
 * published mid-session cannot be hidden by this for longer than it would be
 * hidden by that. Capped, because a determined filterer should not be able to
 * grow a tab's memory without bound.
 */
const CACHE_TTL = 60_000
const CACHE_MAX = 40
const feedCache = new Map<string, { at: number; feed: FeedState }>()

/** One posting's full text, once fetched. Keyed by id; same expiry rules. */
const detailCache = new Map<string, { at: number; job: PublicJob }>()

function readCache<T>(cache: Map<string, { at: number } & T>, key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  // Re-insert so the oldest key is genuinely the least recently USED, not the
  // least recently written.
  cache.delete(key)
  cache.set(key, hit)
  return hit
}

function writeCache<T>(cache: Map<string, { at: number } & T>, key: string, value: T): void {
  cache.set(key, { ...value, at: Date.now() } as { at: number } & T)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/* --------------------------------------------------------------- The board */

export function JobBoard({
  jobs, total, page, perPage, filters, viewer, showFilters = true, liveFilters = false,
}: {
  jobs: PublicJobCard[]
  total: number
  page: number
  perPage: number
  filters: BoardFilters
  viewer: JobViewer
  showFilters?: boolean
  /** Answer filter changes from `/api/jobs/feed` instead of navigating (057). */
  liveFilters?: boolean
}) {
  const [viewing, setViewing] = React.useState<PublicJobCard | null>(null)
  const [applying, setApplying] = React.useState<PublicJobCard | null>(null)
  const [promptFor, setPromptFor] = React.useState<PublicJobCard | null>(null)
  const [applied, setApplied] = React.useState<Set<string>>(
    () => new Set(viewer.kind === 'applicant' ? viewer.appliedJobIds : [])
  )
  const [filtersOpen, setFiltersOpen] = React.useState(false)

  const feedApi = useLiveFeed({ jobs, total, page, filters, enabled: liveFilters })
  const listTop = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (viewer.kind === 'applicant') setApplied(new Set(viewer.appliedJobIds))
  }, [viewer])

  function apply(job: PublicJobCard) {
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

  const shown = feedApi.feed
  const current = feedApi.filters
  const filtering =
    !!current.q || current.types.length > 0 || current.workplaces.length > 0 || current.experience.length > 0

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
            <FilterPanel filters={current} update={feedApi.update} />
          </div>
        </aside>
      ) : null}

      <div ref={listTop} className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <h2
            className={cn(
              'text-xl font-bold tracking-[-0.02em] text-ink transition-opacity',
              feedApi.pending && 'opacity-50'
            )}
            // The count is the one number that is wrong while a new feed is in
            // flight, so it is announced when it settles rather than read out
            // mid-change.
            aria-live="polite"
            aria-busy={feedApi.pending}
          >
            {shown.total} {shown.total === 1 ? 'opportunity' : 'opportunities'} found
          </h2>
          {showFilters ? <SortSelect value={current.sort} update={feedApi.update} /> : null}
        </div>

        {/*
          * Rows that are already on screen DIM rather than being replaced by a
          * skeleton. Swapping twenty cards for twenty grey rectangles and back
          * is a bigger visual event than the filter itself, and it collapses
          * the page height on the way through. A skeleton is right when there
          * is nothing to dim — the first load of an empty result — and nothing
          * at all is right when the answer was cached, which is most clicks.
          */}
        {shown.jobs.length ? (
          <div
            className={cn(
              'grid gap-4 transition-opacity duration-150 md:grid-cols-2',
              // Not interactive while stale: opening a card that is about to be
              // replaced is the one way this could show the wrong posting.
              feedApi.pending && 'pointer-events-none opacity-40'
            )}
          >
            {shown.jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                applied={applied.has(job.id)}
                onView={() => setViewing(job)}
                onApply={() => apply(job)}
              />
            ))}
          </div>
        ) : feedApi.pending ? (
          <JobListSkeleton count={6} />
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

        <Pagination
          page={shown.page}
          perPage={perPage}
          total={shown.total}
          onNavigate={
            liveFilters
              ? (target) => {
                  feedApi.goToPage(target)
                  // A new page of results starts at the top of the list, not
                  // wherever the previous page's footer happened to be.
                  listTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              : undefined
          }
        />
      </div>

      <JobDetailsDialog
        card={viewing}
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

/* ------------------------------------------------------- The live feed hook */

type UpdateFn = (mutate: (query: URLSearchParams) => void) => void

/** The checkbox state the panel should show, read back out of the query string. */
function filtersFromQuery(query: URLSearchParams, fallback: BoardFilters): BoardFilters {
  const list = (name: string) => {
    const raw = query.get(name)
    return raw ? raw.split(',').map((v) => v.trim()).filter(Boolean) : []
  }
  return {
    q: query.get('q') ?? '',
    types: list('type'),
    workplaces: list('mode'),
    experience: list('exp'),
    sort: query.get('sort') ?? fallback.sort ?? 'newest',
  }
}

/**
 * The feed, and the one function that changes it.
 *
 * `enabled: false` makes this a passthrough: the server's props are the feed,
 * and `update` navigates exactly as it used to. Everything below only happens
 * on /jobs itself.
 */
function useLiveFeed({
  jobs, total, page, filters, enabled,
}: {
  jobs: PublicJobCard[]
  total: number
  page: number
  filters: BoardFilters
  enabled: boolean
}): {
  feed: FeedState
  filters: BoardFilters
  pending: boolean
  update: UpdateFn
  goToPage: (target: number) => void
} {
  const router = useProgressRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /*
   * ONE state object, not three.
   *
   * The query, the rows and the spinner change together and must never be
   * observed half-changed: a render that has the new query but the old rows is
   * precisely the glitch where a checkbox is ticked over somebody else's list.
   */
  const [state, setState] = React.useState<{ query: string; feed: FeedState; pending: boolean }>(
    () => ({ query: searchParams.toString(), feed: { jobs, total, page }, pending: false })
  )

  /*
   * A mirror of the state for the callbacks to read.
   *
   * It keeps `update` and `goToPage` referentially STABLE, which is not a
   * micro-optimisation here: `update` is a dependency of the search box's
   * debounce effect, and an `update` that changed identity on every render
   * would restart the 400ms timer on every render and the search would never
   * fire while anything else on the page was moving.
   */
  const stateRef = React.useRef(state)
  stateRef.current = state

  // Only the newest request may write to state: filters get clicked faster than
  // a network answers, and an older response landing last would show the list
  // for a filter the visitor has already changed their mind about.
  const latest = React.useRef(0)

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * RE-SEEDING FROM THE SERVER, AND THE BUG THAT LIVED HERE
   * ───────────────────────────────────────────────────────────────────────────
   * The hero's country switcher and its search box are still real navigations,
   * so after one of those the props are newer than anything in here and the
   * client state has to give way.
   *
   * The trigger has to be a NEW SERVER RENDER and nothing else. It used to be
   * "the query string changed", which was wrong in a way that broke every
   * filter: `useSearchParams()` is synced by Next to `history.replaceState`, so
   * the URL update THIS HOOK performs read back as a navigation. Every filter
   * click therefore reset the feed to the first server render — the unfiltered
   * list — and cleared `pending` while the real request was still in flight.
   * Whichever landed last won, which is why the same URL showed all nine roles
   * once and none the next time.
   *
   * `jobs` is the signal instead, BY REFERENCE. A server render hands down a
   * new array; a client re-render hands down the same one. `window.location`
   * rather than `useSearchParams()` for the same reason as above — it is the
   * URL, not Next's view of it.
   */
  const seeded = React.useRef(false)
  React.useEffect(() => {
    const next: FeedState = { jobs, total, page }
    const query = window.location.search.replace(/^\?/, '')

    // Mount: state is already seeded from props. Only record it for the cache,
    // so coming back to the filters the page opened with costs nothing.
    if (!seeded.current) {
      seeded.current = true
      if (enabled) writeCache(feedCache, query, { feed: next })
      return
    }

    // A genuine server render. Abandon anything in flight and take its word.
    latest.current += 1
    if (enabled) writeCache(feedCache, query, { feed: next })
    setState({ query, feed: next, pending: false })
  }, [jobs, total, page, enabled])

  const load = React.useCallback(async (nextQuery: string) => {
    const cached = readCache(feedCache, nextQuery)
    if (cached) {
      // Already answered. Bump `latest` so a slower request for an earlier
      // filter cannot land on top of this.
      latest.current += 1
      setState((s) => (s.query === nextQuery ? { ...s, feed: cached.feed, pending: false } : s))
      return
    }

    const id = ++latest.current
    setState((s) => (s.query === nextQuery ? { ...s, pending: true } : s))

    try {
      const response = await fetch(`/api/jobs/feed${nextQuery ? `?${nextQuery}` : ''}`, {
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as FeedState

      const next: FeedState = { jobs: data.jobs, total: data.total, page: data.page }
      writeCache(feedCache, nextQuery, { feed: next })

      if (id !== latest.current) return
      // Guarded on the query too: the answer is only allowed to paint if it is
      // still the answer to the question on screen.
      setState((s) => (s.query === nextQuery ? { ...s, feed: next, pending: false } : s))
    } catch {
      if (id !== latest.current) return
      setState((s) => (s.query === nextQuery ? { ...s, pending: false } : s))
      // The list on screen is still a true list, just not the one that was
      // asked for — so it stays, and the failure is said out loud instead.
      toast.error('Could not load roles. Please check your connection and try again.')
    }
  }, [])

  /** Commit a new query string: URL, state and rows, in that order. */
  const go = React.useCallback(
    (qs: string) => {
      /*
       * `replaceState`, not `router.replace`: the address bar has to stay
       * shareable, but asking Next to re-render the route is the entire cost
       * this is avoiding. `replace` rather than `push` also matches what the
       * sidebar did before — a filter is a refinement, not a place to go Back
       * to one checkbox at a time.
       */
      window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname)

      // The checkbox ticks on this render, before any request is made. A cached
      // answer is applied in the same commit, so a revisited filter never
      // flickers through a loading state at all.
      const cached = readCache(feedCache, qs)
      latest.current += 1
      setState((s) => ({
        query: qs,
        feed: cached ? cached.feed : s.feed,
        pending: !cached,
      }))

      if (!cached) void load(qs)
    },
    [pathname, load]
  )

  const update = React.useCallback<UpdateFn>(
    (mutate) => {
      const current = enabled ? stateRef.current.query : searchParams.toString()
      const next = new URLSearchParams(current)
      mutate(next)
      next.delete('page')
      const qs = next.toString()

      if (!enabled) {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
        return
      }
      if (qs === current) return
      go(qs)
    },
    [enabled, searchParams, pathname, router, go]
  )

  const goToPage = React.useCallback(
    (target: number) => {
      const next = new URLSearchParams(stateRef.current.query)
      if (target <= 1) next.delete('page')
      else next.set('page', String(target))
      go(next.toString())
    },
    [go]
  )

  /*
   * The panel reads its checkboxes back out of the CURRENT query string, not
   * out of the server props — otherwise a client-side filter would tick nothing
   * and "Clear all" would never appear.
   */
  const parsed = React.useMemo(
    () => (enabled ? filtersFromQuery(new URLSearchParams(state.query), filters) : filters),
    [enabled, state.query, filters]
  )

  return { feed: state.feed, filters: parsed, pending: state.pending, update, goToPage }
}

/* ------------------------------------------------------------------ Filters */

function FilterPanel({ filters, update }: { filters: BoardFilters; update: UpdateFn }) {
  const [q, setQ] = React.useState(filters.q)

  React.useEffect(() => setQ(filters.q), [filters.q])

  // Typing searches after a short pause rather than on every keystroke. The
  // pause is the whole reason a search box does not generate one request per
  // letter, so it stays here even though the result is now cached as well.
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
            className="text-xs font-medium text-brand-ink hover:underline"
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

function SortSelect({ value, update }: { value: string; update: UpdateFn }) {
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

/* -------------------------------------------------------------- Placeholders */

/**
 * What stands in for the list while a filter is being answered.
 *
 * It mirrors the card's real shape — mark, two lines of heading, a row of
 * pills, a grid of facts, a footer — so the layout does not jump when the rows
 * arrive. `aria-hidden`: the heading above it already carries `aria-busy`, and
 * a screen reader has no use for a description of grey rectangles.
 */
function JobListSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card-surface animate-pulse p-5">
          <div className="flex items-start gap-3.5">
            <div className="size-11 shrink-0 rounded-xl bg-line/70" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-line/70" />
              <div className="h-3 w-1/2 rounded bg-line/50" />
            </div>
          </div>
          <div className="mt-4 flex gap-1.5">
            <div className="h-6 w-20 rounded-full bg-line/50" />
            <div className="h-6 w-24 rounded-full bg-line/50" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-line pt-4">
            {Array.from({ length: 4 }, (_, j) => (
              <div key={j} className="h-3.5 rounded bg-line/50" />
            ))}
          </div>
          <div className="mt-5 h-8 rounded-lg bg-line/40" />
        </div>
      ))}
    </div>
  )
}

/** The detail dialog's body, while the posting's text is on its way. */
function JobDetailSkeleton() {
  return (
    <div className="grid animate-pulse gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" aria-hidden>
      <div className="space-y-3">
        <div className="h-3 w-32 rounded bg-line/70" />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className={cn('h-3.5 rounded bg-line/50', i % 3 === 2 && 'w-2/3')} />
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-line/40" />
    </div>
  )
}

/* -------------------------------------------------------------------- Cards */

function JobCard({
  job, applied, onView, onApply,
}: {
  job: PublicJobCard
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
              <button type="button" onClick={onView} className="text-left hover:text-brand-ink">
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
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-ink">
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

/**
 * One posting's full text, fetched when it is actually opened (057).
 *
 * The feed carries card fields only, so this is where the description,
 * responsibilities, requirements, skills and recruiter block come from. Cached
 * per id, because closing a dialog and reopening it — or opening the same
 * posting from a second filter view — is common and should cost nothing.
 */
function useJobDetail(id: string | null): { job: PublicJob | null; failed: boolean } {
  const [state, setState] = React.useState<{ job: PublicJob | null; failed: boolean }>({
    job: null,
    failed: false,
  })

  React.useEffect(() => {
    if (!id) {
      setState({ job: null, failed: false })
      return
    }

    const cached = readCache(detailCache, id)
    if (cached) {
      setState({ job: cached.job, failed: false })
      return
    }

    let live = true
    setState({ job: null, failed: false })

    fetch(`/api/jobs/${id}`, { headers: { Accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('unavailable'))))
      .then((job: PublicJob) => {
        if (!live) return
        writeCache(detailCache, id, { job })
        setState({ job, failed: false })
      })
      .catch(() => {
        if (live) setState({ job: null, failed: true })
      })

    // A dialog closed before its posting arrived must not write to state after.
    return () => {
      live = false
    }
  }, [id])

  return state
}

function JobDetailsDialog({
  card, applied, onClose, onApply,
}: {
  card: PublicJobCard | null
  applied: boolean
  onClose: () => void
  onApply: (job: PublicJobCard) => void
}) {
  const { job, failed } = useJobDetail(card?.id ?? null)

  async function share() {
    if (!card) return
    const url = `${window.location.origin}/jobs/${card.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: card.title, text: `${card.title} at ${card.company.name}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      // A dismissed share sheet is not an error worth telling anyone about.
    }
  }

  return (
    <Dialog open={!!card} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="xl">
        {card ? (
          <>
            {/* The header needs nothing the card did not already have, so it is
                there the instant the dialog opens — only the body waits. */}
            <DialogHeader className="border-b border-line">
              <div className="flex items-start gap-4 pr-8">
                <CompanyMark company={card.company} size="lg" />
                <div className="min-w-0">
                  <DialogTitle className="text-xl">{card.title}</DialogTitle>
                  <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-ink">{card.company.name}</span>
                    {card.location ? (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden />
                        {card.location}
                      </span>
                    ) : null}
                  </DialogDescription>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-ink">
                      {JOB_TYPE_LABELS[card.employmentType]}
                    </span>
                    <span className="rounded-full bg-page px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink ring-1 ring-inset ring-line">
                      {JOB_WORKPLACE_LABELS[card.workplace]}
                    </span>
                  </div>
                </div>
              </div>
            </DialogHeader>
            <DialogBody className="py-6" aria-busy={!job && !failed}>
              {job ? (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <JobDescription job={job} />
                  <div className="space-y-4">
                    <JobSummary job={job} />
                    <RecruiterContact job={job} />
                  </div>
                </div>
              ) : failed ? (
                <EmptyState
                  icon={Briefcase}
                  title="This role could not be loaded"
                  description="It may have been closed while you were browsing. Open the full page to check."
                />
              ) : (
                <JobDetailSkeleton />
              )}
            </DialogBody>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="secondary" onClick={share}>
                <Share2 />
                Share job
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" asChild>
                  <Link href={`/jobs/${card.id}`}>Open full page</Link>
                </Button>
                {applied ? (
                  <Button disabled>
                    <Check />
                    Applied
                  </Button>
                ) : (
                  <Button onClick={() => onApply(card)} className="min-w-40">
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
export function SignInPrompt({ job, onClose }: { job: PublicJobCard | null; onClose: () => void }) {
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
