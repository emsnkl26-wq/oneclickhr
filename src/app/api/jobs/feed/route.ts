/**
 * The portal feed as JSON — what a filter click fetches (057).
 *
 * WHY THIS EXISTS. Every filter, sort and page change used to be a full
 * navigation: Next re-rendered the whole /jobs server component, which re-read
 * the country list, the feed, the companies and the signed-in viewer, and
 * shipped a fresh RSC payload for the hero, the sidebar and the footer — to
 * change which twenty cards are on screen. This route answers the only part
 * that actually changed.
 *
 * The first paint is still server-rendered by `page.tsx`, so a crawler and a
 * visitor with no JavaScript get the real list at the real URL. This route
 * takes over afterwards.
 *
 * WHAT IT MAY RETURN. `listPublicJobs` and nothing else — the same
 * service-role-backed, `status = 'published'` read the page uses (see the
 * header of src/lib/jobs-public.ts), returning card columns only. There is no
 * viewer here and no session is read: the response is identical for everyone,
 * which is exactly what lets it be cached by the CDN.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { listPublicJobs, listPublicJobCountries, FEED_PER_PAGE } from '@/lib/jobs-public'
import { parseJobFeedParams, resolveCountry } from '@/lib/job-feed-params'
import { withErrorHandler } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const params = parseJobFeedParams(request.nextUrl.searchParams)

  /*
   * The geo default is resolved here the same way the page resolves it, so that
   * a client which simply forwards its current query string gets the same feed
   * the server rendered. The country list is cached and usually free.
   */
  const countries = await listPublicJobCountries()
  const country = resolveCountry(
    params.requestedCountry,
    request.headers.get('x-vercel-ip-country') ?? '',
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

  return NextResponse.json(
    { ...feed, perPage: FEED_PER_PAGE, country },
    {
      headers: {
        /*
         * Public and identical for every caller, so the CDN may hold it. The
         * window matches the data cache's own TTL; `stale-while-revalidate`
         * means the slow path is paid by a background refresh rather than by
         * whoever happens to click first after it expires.
         *
         * Safe ONLY because nothing above reads a cookie. If this route ever
         * needs the viewer, it needs `private, no-store` instead — or, better,
         * the viewer stays where it is and this stays cacheable.
         */
        'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
      },
    }
  )
})
