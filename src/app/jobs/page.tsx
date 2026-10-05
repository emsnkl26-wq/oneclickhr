import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { listPublicJobs, listPublicJobCountries, FEED_PER_PAGE } from '@/lib/jobs-public'
import { parseJobFeedParams, resolveCountry } from '@/lib/job-feed-params'
import { loadJobViewer } from '@/lib/job-viewer-server'
import { JobHero } from './job-hero'
import { JobBoard } from './job-board'
import { BRAND } from '@/lib/brand'

export const metadata: Metadata = {
  title: 'Open roles',
  description:
    `Full-time, contract, C2C and W2 roles from organizations hiring through ${BRAND.name}. Browse by country and apply in a click.`,
}

export const dynamic = 'force-dynamic'

/**
 * The portal feed — THE FIRST PAINT ONLY (057).
 *
 * Reads through `listPublicJobs`, which is service-role backed, cached, and
 * hard-codes `status = 'published'` — see the header of src/lib/jobs-public.ts.
 * Nothing on this page may reach the database any other way (the viewer, below,
 * reads only the caller's own rows on their own session).
 *
 * Every filter click AFTER this render is answered by `/api/jobs/feed` and
 * swaps only the list — see job-board.tsx. This page still renders the whole
 * list for whatever URL was asked for, so the result is server-rendered for a
 * crawler, for a shared link and for a visitor with no JavaScript. The URL
 * remains the source of truth either way.
 *
 * The parsing is shared with that route (`parseJobFeedParams`) precisely so the
 * two cannot answer the same URL differently.
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
  const raw = await searchParams
  // `searchParams` is a plain object here; the shared parser reads a
  // `URLSearchParams`, which is what the API route has.
  const params = parseJobFeedParams(
    new URLSearchParams(
      Object.entries(raw).filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
  )

  const [countries, viewer, headerList] = await Promise.all([
    listPublicJobCountries(),
    loadJobViewer(),
    headers(),
  ])

  const country = resolveCountry(
    params.requestedCountry,
    headerList.get('x-vercel-ip-country') ?? '',
    new Set(countries.map((c) => c.code))
  )

  const feed = await listPublicJobs({
    q: params.q,
    types: params.types,
    workplaces: params.workplaces,
    experience: params.experience,
    posted: params.posted,
    country: country ?? undefined,
    sort: params.sort,
    page: params.page,
  })

  return (
    <>
      <JobHero country={country} countries={countries} q={params.q} />
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <JobBoard
          jobs={feed.jobs}
          total={feed.total}
          page={feed.page}
          perPage={FEED_PER_PAGE}
          filters={{
            q: params.q,
            types: params.types,
            workplaces: params.workplaces,
            experience: params.experience,
            sort: params.sort,
          }}
          viewer={viewer}
          liveFilters
        />
      </div>
    </>
  )
}
