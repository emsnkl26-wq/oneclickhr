import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { listPublicJobs, listPublicJobCountries, FEED_PER_PAGE } from '@/lib/jobs-public'
import { EXPERIENCE_BANDS, JOB_SORTS, POSTED_WITHIN, type ExperienceBand, type JobSort, type PostedWithin } from '@/lib/job-form'
import { JOB_TYPES, JOB_WORKPLACES } from '@/lib/schemas'
import { loadJobViewer } from '@/lib/job-viewer-server'
import { JobHero } from './job-hero'
import { JobBoard } from './job-board'

export const metadata: Metadata = {
  title: 'Open roles',
  description:
    'Full-time, contract, C2C and W2 roles from organizations hiring through Oneclickhr. Browse by country and apply in a click.',
}

export const dynamic = 'force-dynamic'

/** A comma list from the URL, kept to the values `allowed` actually contains. */
function listParam<T extends string>(value: string | undefined, allowed: readonly T[]): T[] {
  if (!value) return []
  const set = new Set(allowed as readonly string[])
  return Array.from(new Set(value.split(',').map((v) => v.trim()))).filter((v): v is T => set.has(v))
}

/**
 * The portal feed.
 *
 * Reads through `listPublicJobs`, which is service-role backed and hard-codes
 * `status = 'published'` — see the header of src/lib/jobs-public.ts. Nothing on
 * this page may reach the database any other way (the viewer, below, reads only
 * the caller's own rows on their own session).
 *
 * THE COUNTRY. `?country=XX` or `?country=all`. With neither, the visitor's own
 * country (Vercel's geo header) is used when there are postings there, and all
 * countries otherwise — landing somebody on an empty list is the worst default.
 */
export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    type?: string
    mode?: string
    exp?: string
    posted?: string
    country?: string
    sort?: string
    page?: string
  }>
}) {
  const params = await searchParams

  const types = listParam(params.type, JOB_TYPES)
  const workplaces = listParam(params.mode, JOB_WORKPLACES)
  const experience = listParam(params.exp, Object.keys(EXPERIENCE_BANDS) as ExperienceBand[])
  // Own-property checks, not `in`: a param of "toString" must not pass.
  const posted = Object.hasOwn(POSTED_WITHIN, params.posted ?? '')
    ? (params.posted as PostedWithin)
    : undefined
  const sort: JobSort = Object.hasOwn(JOB_SORTS, params.sort ?? '') ? (params.sort as JobSort) : 'newest'
  const search = (params.q ?? '').trim().slice(0, 80)
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)

  const [countries, viewer, headerList] = await Promise.all([
    listPublicJobCountries(),
    loadJobViewer(),
    headers(),
  ])

  const requested = (params.country ?? '').trim().toUpperCase()
  const known = new Set(countries.map((c) => c.code))
  let country: string | null = null
  if (requested === 'ALL') {
    country = null
  } else if (/^[A-Z]{2}$/.test(requested)) {
    // A country with no postings is still honoured — the link said so, and the
    // switcher offers a way out — but it has to be a real two-letter code.
    country = requested
  } else {
    const visitor = (headerList.get('x-vercel-ip-country') ?? '').toUpperCase()
    country = /^[A-Z]{2}$/.test(visitor) && known.has(visitor) ? visitor : null
  }

  const feed = await listPublicJobs({
    q: search,
    types,
    workplaces,
    experience,
    posted,
    country: country ?? undefined,
    sort,
    page,
  })

  return (
    <>
      <JobHero country={country} countries={countries} q={search} />
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <JobBoard
          jobs={feed.jobs}
          total={feed.total}
          page={feed.page}
          perPage={FEED_PER_PAGE}
          filters={{ q: search, types, workplaces, experience, sort }}
          viewer={viewer}
        />
      </div>
    </>
  )
}
