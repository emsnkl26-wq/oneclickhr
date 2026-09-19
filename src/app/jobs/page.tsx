import type { Metadata } from 'next'
import { BriefcaseBusiness } from 'lucide-react'
import { EmptyState } from '@/components/ui/patterns'
import { SearchField } from '@/components/ui/search-field'
import { FilterSelect } from '@/components/ui/filter-select'
import { Pagination } from '@/components/ui/pagination'
import { listPublicJobs, FEED_PER_PAGE } from '@/lib/jobs-public'
import {
  EXPERIENCE_BANDS,
  JOB_TYPE_LABELS,
  JOB_WORKPLACE_LABELS,
  POSTED_WITHIN,
  type ExperienceBand,
  type PostedWithin,
} from '@/lib/jobs'
import { JOB_TYPES, JOB_WORKPLACES } from '@/lib/schemas'
import { JobCard } from './job-card'

export const metadata: Metadata = {
  title: 'Open roles',
  description:
    'Every open role from organizations hiring through Oneclickhr. Browse and apply — no account needed.',
}

export const dynamic = 'force-dynamic'

/**
 * The portal feed.
 *
 * Reads through `listPublicJobs`, which is service-role backed and hard-codes
 * `status = 'published'` — see the header of src/lib/jobs-public.ts. Nothing on
 * this page may reach the database any other way.
 *
 * Filters live in the URL and the server answers them, the same contract as
 * every list page inside the app. It matters more here than anywhere else: a URL
 * that carries the search is a URL someone can share, bookmark and be linked to
 * from the marketing site, which is most of the point of a public portal.
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    type?: string
    workplace?: string
    experience?: string
    posted?: string
    page?: string
  }>
}) {
  const params = await searchParams

  const type = JOB_TYPES.includes(params.type as (typeof JOB_TYPES)[number])
    ? params.type
    : undefined
  const workplace = JOB_WORKPLACES.includes(params.workplace as (typeof JOB_WORKPLACES)[number])
    ? params.workplace
    : undefined
  // Own-property checks, not `in`: a param of "toString" must not pass.
  const experience = Object.hasOwn(EXPERIENCE_BANDS, params.experience ?? '')
    ? (params.experience as ExperienceBand)
    : undefined
  const posted = Object.hasOwn(POSTED_WITHIN, params.posted ?? '')
    ? (params.posted as PostedWithin)
    : undefined
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)

  const feed = await listPublicJobs({ q: search, type, workplace, experience, posted, page })
  const filtering = !!(search || type || workplace || experience || posted)

  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <h1 className="text-[30px] font-bold leading-[1.15] tracking-[-0.03em] text-ink">
          Find your next role
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          Open positions from organizations hiring through Oneclickhr. You do not need an
          account to apply — just a CV and a few minutes.
        </p>
      </header>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchField
          param="q"
          placeholder="Search by title or location"
          label="Search jobs"
          className="lg:flex-1"
        />
        {/* `min-w-0` on the flex items: a Select is `w-full`, so without it two
            of them side by side on a phone push past the viewport instead of
            sharing the row. */}
        {/* Two columns on a phone, one row from `sm` up. Four selects in a
            single row cannot share a 360px viewport legibly. */}
        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
          {/* `value: ''` is how FilterSelect spells "clear this parameter". */}
          <FilterSelect
            param="type"
            label="Job type"
            className="min-w-0 sm:w-36 sm:flex-none"
            options={[
              { value: '', label: 'Any type' },
              ...JOB_TYPES.map((value) => ({ value, label: JOB_TYPE_LABELS[value] })),
            ]}
          />
          <FilterSelect
            param="workplace"
            label="Workplace"
            className="min-w-0 sm:w-36 sm:flex-none"
            options={[
              { value: '', label: 'Anywhere' },
              ...JOB_WORKPLACES.map((value) => ({
                value,
                label: JOB_WORKPLACE_LABELS[value],
              })),
            ]}
          />
          <FilterSelect
            param="experience"
            label="Experience"
            className="min-w-0 sm:w-44 sm:flex-none"
            options={[
              { value: '', label: 'Any experience' },
              ...Object.entries(EXPERIENCE_BANDS).map(([value, band]) => ({
                value,
                label: band.label,
              })),
            ]}
          />
          <FilterSelect
            param="posted"
            label="Date posted"
            className="min-w-0 sm:w-40 sm:flex-none"
            options={[
              { value: '', label: 'Any time' },
              ...Object.entries(POSTED_WITHIN).map(([value, window]) => ({
                value,
                label: window.label,
              })),
            ]}
          />
        </div>
      </div>

      {feed.total ? (
        <p className="text-sm text-ink-muted">
          {feed.total} open {feed.total === 1 ? 'role' : 'roles'}
        </p>
      ) : null}

      {feed.jobs.length ? (
        <div className="space-y-3">
          {feed.jobs.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={BriefcaseBusiness}
          title={filtering ? 'No roles match that' : 'No open roles right now'}
          description={
            filtering
              ? 'Try a broader search, or clear the filters to see everything on offer.'
              : 'Nothing is being advertised at the moment. Check back soon.'
          }
        />
      )}

      <Pagination page={feed.page} perPage={FEED_PER_PAGE} total={feed.total} />
    </div>
  )
}
