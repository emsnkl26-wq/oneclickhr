import 'server-only'

/**
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THE ONLY MODULE IN THIS CODEBASE THAT READS DATA FOR AN                │
 * │ UNAUTHENTICATED CALLER.                                                │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * WHY IT EXISTS
 * -------------
 * 002_rls.sql ends with `revoke all on all tables in schema public from anon`,
 * under a comment saying nothing in this product is public. The job portal is
 * the first thing that is — and rather than grant `anon` a table privilege (see
 * the header of 015_jobs.sql for why that trade was refused), the portal reads
 * with the SERVICE ROLE from this one file.
 *
 * WHAT THAT COSTS, AND THE RULE THAT PAYS IT
 * ------------------------------------------
 * The service role bypasses RLS entirely. Nothing below is protected by a
 * policy; the filters ARE the protection. So:
 *
 *   1. EVERY query here filters `status = 'published'`. No exceptions, no
 *      parameter that can turn it off, no helper that takes a status.
 *   2. EVERY query names its columns. `select('*')` on a table that later grows
 *      an internal column would publish it to the internet on the next deploy.
 *   3. NOTHING here accepts a tenant id from a caller as a trust boundary — a
 *      tenant filter is a listing convenience, never an authorization check,
 *      because everything reachable from here is world-readable by design.
 *   4. NO function here returns a `job_applications` row, or any column of one.
 *      That table is PII belonging to people who did not sign up for this
 *      product, and it has no business on a public page.
 *
 * If you need a job for an authenticated surface — the org's own list, the
 * super-admin console, an employee's browse — do NOT import this. Use
 * `createSupabaseServerClient()` and let `jobs_select` do its job.
 */
import { cache } from 'react'
import { unstable_cache, revalidateTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { JOB_CARD_COLUMNS, JOB_COLUMNS, toPublicJob, toPublicJobCard, type JobCardRow } from '@/lib/jobs'
import {
  EXPERIENCE_BANDS,
  POSTED_WITHIN,
  type ExperienceBand,
  type JobSort,
  type PostedWithin,
} from '@/lib/job-form'
import type { Job, PublicCompany, PublicJob, PublicJobCard } from '@/types/db'

/**
 * The cache tag every public-portal read is stored under (057).
 *
 * ONE tag for the whole portal, not one per filter combination. The set of
 * live postings changes when an org publishes, edits or closes a role — and any
 * of those can move a job into or out of an unbounded number of cached filter
 * combinations, so there is no honest way to invalidate a subset. Dropping all
 * of it costs one cold query per combination that is asked for again; getting
 * the subset wrong means a closed role stays on the portal.
 *
 * Call `revalidatePublicJobs()` from every route that writes a `jobs` row.
 */
export const PUBLIC_JOBS_TAG = 'public-jobs'

/**
 * How long a cached portal read may be served before it is refetched.
 *
 * These are short on purpose. The thing being cached is a PUBLIC job board, so
 * the cost of staleness is that a role posted seconds ago appears a minute
 * late — and every write path calls `revalidatePublicJobs()` anyway, which makes
 * the window a backstop rather than the mechanism.
 */
const FEED_TTL = 60
const COUNTRIES_TTL = 300
const JOB_TTL = 120

/** Drop every cached portal read. Call after any write to `jobs`. */
export function revalidatePublicJobs(): void {
  revalidateTag(PUBLIC_JOBS_TAG)
}

/**
 * Wrap a `jobs` write handler so a successful write empties the portal cache.
 *
 * AT THE EXPORT, not inside the handler, and deliberately: these routes create,
 * edit, publish, close and delete postings across several branches apiece, and
 * the one branch somebody forgets is the one that leaves a closed role on a
 * public page. Wrapping the whole handler cannot be forgotten per-branch.
 *
 * Only a 2xx revalidates — a rejected edit changed nothing and should not throw
 * away a warm cache for every visitor.
 */
export function withPublicJobsRevalidation<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args): Promise<Response> => {
    const response = await handler(...args)
    if (response.ok) revalidatePublicJobs()
    return response
  }
}

/** The columns the portal needs from `tenants`, and not the domain token. */
const COMPANY_COLUMNS = 'id, name, slug, logo_url, website, city, country, company_linkedin_url'

interface TenantRow {
  id: string
  name: string
  slug: string
  logo_url: string | null
  website: string | null
  city: string | null
  country: string | null
  company_linkedin_url: string | null
}

/** OneclickHR itself, for a platform posting. */
const PLATFORM_COMPANY: PublicCompany = {
  id: null,
  name: 'OneclickHR',
  slug: null,
  isPlatform: true,
  logoUrl: null,
  website: 'https://oneclickhr.app',
  location: null,
  linkedinUrl: null,
}

function toCompany(row: TenantRow | undefined | null): PublicCompany {
  if (!row) return PLATFORM_COMPANY
  const place = [row.city, row.country].filter(Boolean).join(', ')
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    isPlatform: false,
    /*
     * NOT the R2 key. `tenants.logo_url` holds an object key in a private
     * bucket, and handing one to a browser would be both useless and a small
     * information leak. `/api/jobs/logo` is the public, tenant-checked redirect.
     */
    // Only when there IS a logo — otherwise every card rendered a broken image.
    logoUrl: row.logo_url ? `/api/jobs/logo?tenant=${encodeURIComponent(row.id)}` : null,
    website: row.website,
    location: place || null,
    linkedinUrl: row.company_linkedin_url ?? null,
  }
}

export interface JobFeedFilters {
  q?: string
  /** Any of these employment types (OR). Unknown values are dropped by the caller. */
  types?: string[]
  /** Any of these workplaces (OR). */
  workplaces?: string[]
  /** Any of these bands (OR) — see EXPERIENCE_BANDS. */
  experience?: ExperienceBand[]
  /** A key of POSTED_WITHIN — only postings published inside that window. */
  posted?: PostedWithin
  /** ISO 3166-1 alpha-2. Absent means every country. */
  country?: string
  sort?: JobSort
  /** A tenant slug. A listing convenience — see rule 3 in the header. */
  company?: string
  page?: number
  perPage?: number
}

export interface JobFeed {
  jobs: PublicJobCard[]
  total: number
  page: number
  perPage: number
}

export const FEED_PER_PAGE = 20

/**
 * An experience band as a PostgREST condition: the posting's range OVERLAPS the
 * band, with an unstated bound treated as open (see EXPERIENCE_BANDS). The
 * numbers come from the constant table, never from the request.
 */
function experienceCondition(band: ExperienceBand): string {
  const { min, max } = EXPERIENCE_BANDS[band]
  const upper = `or(experience_max.is.null,experience_max.gte.${min})`
  return max === null
    ? upper
    : `and(or(experience_min.is.null,experience_min.lte.${max}),${upper})`
}

/**
 * The portal feed: published jobs, newest first.
 *
 * Two round trips rather than a PostgREST embed. The embed would be one query,
 * but it also makes the tenant join part of the filter surface, and a filter
 * surface is precisely what must stay small here. Fetching the page of jobs and
 * then the handful of companies they belong to keeps the `status = 'published'`
 * predicate the only thing standing between this function and the whole table.
 */
async function fetchPublicJobs(filters: JobFeedFilters): Promise<JobFeed> {
  const admin = createAdminClient()
  const perPage = filters.perPage ?? FEED_PER_PAGE
  const page = Math.max(1, filters.page ?? 1)
  const from = (page - 1) * perPage

  let tenantId: string | null = null
  if (filters.company) {
    const { data } = await admin
      .from('tenants')
      .select('id')
      .eq('slug', filters.company)
      .eq('status', 'active')
      .maybeSingle()
    // An unknown slug must return nothing, not everything. Without this the
    // filter would silently fall through to the unfiltered feed.
    if (!data) return { jobs: [], total: 0, page, perPage }
    tenantId = (data as { id: string }).id
  }

  let query = admin
    .from('jobs')
    // The CARD columns (057) — a list never selects a description. The detail
    // view reads the whole row from `getPublicJob` for the one posting it shows.
    .select(JOB_CARD_COLUMNS, { count: 'exact' })
    .eq('status', 'published')

  if (tenantId) query = query.eq('tenant_id', tenantId)
  if (filters.types?.length) query = query.in('employment_type', filters.types)
  if (filters.workplaces?.length) query = query.in('workplace', filters.workplaces)
  if (filters.country) query = query.eq('country', filters.country)

  if (filters.experience?.length) {
    // Several bands are ORed; separate `or` calls (search below) are ANDed.
    query = query.or(filters.experience.map(experienceCondition).join(','))
  }

  if (filters.posted) {
    const cutoff = new Date(Date.now() - POSTED_WITHIN[filters.posted].hours * 3600_000)
    query = query.gte('published_at', cutoff.toISOString())
  }

  if (filters.q) {
    /*
     * PostgREST's `or` takes a comma-separated list, and a comma or a parenthesis
     * inside the term would end the clause early and change which columns are
     * searched. Stripped rather than escaped: this is a search box, and a term
     * containing `(` is not a query anyone is trying to run.
     */
    const term = filters.q.replace(/[,()*\\%:]/g, ' ').trim().slice(0, 80)
    if (term) {
      query = query.or(
        `title.ilike.%${term}%,location.ilike.%${term}%,client_name.ilike.%${term}%,description.ilike.%${term}%`
      )
    }
  }

  const { data, count, error } = await query
    .order('published_at', { ascending: filters.sort === 'oldest' })
    .range(from, from + perPage - 1)

  if (error) {
    console.error('[jobs-public] feed unavailable', error.message)
    return { jobs: [], total: 0, page, perPage }
  }

  const rows = (data ?? []) as unknown as JobCardRow[]
  const companies = await loadCompanies(rows)

  return {
    jobs: rows.map((row) =>
      toPublicJobCard(row, companies.get(row.tenant_id ?? '') ?? PLATFORM_COMPANY)
    ),
    total: count ?? rows.length,
    page,
    perPage,
  }
}

/**
 * A stable cache key for a set of filters.
 *
 * Normalised rather than stringified as given: `?type=w2,c2c` and `?type=c2c,w2`
 * are the same feed, and two keys for one answer halves the hit rate for no
 * reason. Array order is sorted, the search term is lowercased and trimmed, and
 * absent values are omitted entirely so that an unfiltered feed has exactly one
 * key however the page happened to spell it.
 */
function feedCacheKey(filters: JobFeedFilters): string {
  const parts: string[] = []
  const list = (name: string, values: string[] | undefined) => {
    if (values?.length) parts.push(`${name}=${[...values].sort().join('.')}`)
  }
  const value = (name: string, v: string | number | undefined | null) => {
    if (v !== undefined && v !== null && v !== '') parts.push(`${name}=${v}`)
  }

  value('q', filters.q?.trim().toLowerCase())
  list('type', filters.types)
  list('mode', filters.workplaces)
  list('exp', filters.experience)
  value('posted', filters.posted)
  value('country', filters.country)
  value('sort', filters.sort ?? 'newest')
  value('company', filters.company)
  value('page', Math.max(1, filters.page ?? 1))
  value('per', filters.perPage ?? FEED_PER_PAGE)
  return parts.join('&') || 'all'
}

/**
 * The portal feed, cached (057).
 *
 * A job board is the one thing in this product where every visitor asking the
 * same question deserves the same answer: the feed is public, identical for
 * everyone, and read far more often than it is written. Before this, clicking
 * "Full time" re-ran the whole query — for every visitor, every time, including
 * the ones who clicked it a second ago.
 *
 * `unstable_cache` keys on the normalised filters, so the handful of
 * combinations people actually use (the defaults, one country, one type) stay
 * warm, while an exotic combination costs exactly what it used to. Tagged, so a
 * publish or a close empties it immediately rather than leaving a dead role up
 * for a minute.
 *
 * NOTHING CACHED HERE MAY DEPEND ON THE CALLER. That is why the viewer, the
 * geo header and the applied-job set are resolved by the page and not in here —
 * a cache entry keyed on filters alone must not contain one visitor's data.
 */
export async function listPublicJobs(filters: JobFeedFilters = {}): Promise<JobFeed> {
  const key = feedCacheKey(filters)
  return unstable_cache(() => fetchPublicJobs(filters), ['public-job-feed', key], {
    revalidate: FEED_TTL,
    tags: [PUBLIC_JOBS_TAG],
  })()
}

/**
 * Every country with at least one live posting, most postings first — what the
 * portal's country switcher offers. Postings with no country are not counted:
 * they show under "All countries".
 *
 * COUNTED BY THE DATABASE (057). This used to select the `country` column of up
 * to 5000 published rows and tally them in a Map — on every request, including
 * every filter click, and it ignores the filters, so the work was identical
 * every time. `public_job_country_counts()` is the same thing as a `group by`,
 * and the result is cached for five minutes besides.
 */
export const listPublicJobCountries = unstable_cache(
  async (): Promise<Array<{ code: string; count: number }>> => {
    const admin = createAdminClient()
    const { data, error } = await admin.rpc('public_job_country_counts')

    if (error) {
      console.error('[jobs-public] countries unavailable', error.message)
      return []
    }

    // The two-letter check stays: the aggregate returns whatever is stored, and
    // a malformed code would become a switcher entry that filters to nothing.
    return ((data ?? []) as Array<{ country: string | null; job_count: number }>)
      .filter((row): row is { country: string; job_count: number } =>
        !!row.country && /^[A-Z]{2}$/.test(row.country)
      )
      .map((row) => ({ code: row.country, count: Number(row.job_count) }))
  },
  ['public-job-countries'],
  { revalidate: COUNTRIES_TTL, tags: [PUBLIC_JOBS_TAG] }
)

/** One published job, or null. Null covers "draft", "closed" and "never existed"
 *  alike — the portal must not be able to tell an outsider which. */
const fetchPublicJob = unstable_cache(
  async (id: string): Promise<PublicJob | null> => {
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('jobs')
      .select(JOB_COLUMNS)
      .eq('id', id)
      .eq('status', 'published')
      .maybeSingle()

    if (error || !data) return null

    const row = data as unknown as Job
    const companies = await loadCompanies([row])
    return toPublicJob(row, companies.get(row.tenant_id ?? '') ?? PLATFORM_COMPANY)
  },
  ['public-job'],
  { revalidate: JOB_TTL, tags: [PUBLIC_JOBS_TAG] }
)

/**
 * Wrapped in React `cache()` as well as the data cache, and for a different
 * reason: `/jobs/[id]` calls this twice per request — once in `generateMetadata`
 * and once in the page — and Next runs those as two separate invocations. The
 * request-scoped memo collapses them into one. The data cache underneath it
 * then collapses the first visitor's query and the next hundred.
 */
export const getPublicJob = cache(
  async (id: string): Promise<PublicJob | null> => fetchPublicJob(id)
)

/**
 * A company with at least one live posting, by slug.
 *
 * Returns null for a tenant that has none — an org with nothing published has no
 * public page, which is the difference between a careers page and a directory of
 * every customer this platform has.
 */
export const getPublicCompany = cache(async (slug: string): Promise<PublicCompany | null> => {
  const admin = createAdminClient()

  const { data } = await admin
    .from('tenants')
    .select(COMPANY_COLUMNS)
    .eq('slug', slug)
    .eq('status', 'active')
    .maybeSingle()

  if (!data) return null
  const tenant = data as unknown as TenantRow

  const { count } = await admin
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('status', 'published')

  if (!count) return null
  return toCompany(tenant)
})

/**
 * Does this job exist and accept applications right now?
 *
 * Used by the presign route before it mints an upload URL, and by the apply
 * route before it writes a row. Returns the hiring tenant so the caller can
 * stamp it onto the application without a second read — see the privacy note in
 * 015_jobs.sql for why that value must come from the job and never the applicant.
 */
export async function getOpenJobForApply(
  id: string
): Promise<{ id: string; title: string; tenantId: string | null; closesAt: string | null } | null> {
  const admin = createAdminClient()

  const { data } = await admin
    .from('jobs')
    .select('id, title, tenant_id, closes_at')
    .eq('id', id)
    .eq('status', 'published')
    .maybeSingle()

  if (!data) return null
  const row = data as { id: string; title: string; tenant_id: string | null; closes_at: string | null }
  return { id: row.id, title: row.title, tenantId: row.tenant_id, closesAt: row.closes_at }
}

/**
 * The R2 key of a company logo — but only for a tenant that is currently
 * advertising.
 *
 * The published-job check is the authorization: without it this would be an
 * endpoint that confirms whether any given uuid is a customer of this platform,
 * and serves their branding to anyone who asks.
 */
export async function getAdvertisingCompanyLogo(tenantId: string): Promise<string | null> {
  const admin = createAdminClient()

  const { count } = await admin
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'published')

  if (!count) return null

  const { data } = await admin
    .from('tenants')
    .select('logo_url')
    .eq('id', tenantId)
    .eq('status', 'active')
    .maybeSingle()

  return (data as { logo_url: string | null } | null)?.logo_url ?? null
}

/** Every published job's id and timestamp, for the sitemap. */
export async function listPublicJobIds(): Promise<Array<{ id: string; updatedAt: string }>> {
  const admin = createAdminClient()

  const { data } = await admin
    .from('jobs')
    .select('id, updated_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(5000)

  return ((data ?? []) as Array<{ id: string; updated_at: string }>).map((row) => ({
    id: row.id,
    updatedAt: row.updated_at,
  }))
}

/** Every company slug with a live posting, for the sitemap. */
export async function listAdvertisingCompanySlugs(): Promise<string[]> {
  const admin = createAdminClient()

  const { data } = await admin.from('jobs').select('tenant_id').eq('status', 'published').limit(5000)

  const ids = Array.from(
    new Set(
      ((data ?? []) as Array<{ tenant_id: string | null }>)
        .map((row) => row.tenant_id)
        .filter((id): id is string => !!id)
    )
  )
  if (!ids.length) return []

  const { data: tenants } = await admin
    .from('tenants')
    .select('slug')
    .in('id', ids)
    .eq('status', 'active')

  return ((tenants ?? []) as Array<{ slug: string }>).map((row) => row.slug)
}

/** The companies behind a page of jobs, keyed by tenant id. */
async function loadCompanies(
  rows: Array<{ tenant_id: string | null }>
): Promise<Map<string, PublicCompany>> {
  const ids = Array.from(new Set(rows.map((row) => row.tenant_id).filter((id): id is string => !!id)))
  const map = new Map<string, PublicCompany>()
  if (!ids.length) return map

  const admin = createAdminClient()
  const { data } = await admin.from('tenants').select(COMPANY_COLUMNS).in('id', ids)

  for (const row of (data ?? []) as unknown as TenantRow[]) {
    map.set(row.id, toCompany(row))
  }
  return map
}
