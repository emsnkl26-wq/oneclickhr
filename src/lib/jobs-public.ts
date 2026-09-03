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
import { createAdminClient } from '@/lib/supabase/admin'
import { JOB_COLUMNS, toPublicJob } from '@/lib/jobs'
import type { Job, PublicCompany, PublicJob } from '@/types/db'

/** The columns the portal needs from `tenants`, and not the domain token. */
const COMPANY_COLUMNS = 'id, name, slug, logo_url, website, city, country'

interface TenantRow {
  id: string
  name: string
  slug: string
  logo_url: string | null
  website: string | null
  city: string | null
  country: string | null
}

/** Oneclickhr itself, for a platform posting. */
const PLATFORM_COMPANY: PublicCompany = {
  id: null,
  name: 'Oneclickhr',
  slug: null,
  isPlatform: true,
  logoUrl: null,
  website: 'https://oneclickhr.app',
  location: null,
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
    logoUrl: `/api/jobs/logo?tenant=${encodeURIComponent(row.id)}`,
    website: row.website,
    location: place || null,
  }
}

export interface JobFeedFilters {
  q?: string
  type?: string
  workplace?: string
  /** A tenant slug. A listing convenience — see rule 3 in the header. */
  company?: string
  page?: number
  perPage?: number
}

export interface JobFeed {
  jobs: PublicJob[]
  total: number
  page: number
  perPage: number
}

export const FEED_PER_PAGE = 20

/**
 * The portal feed: published jobs, newest first.
 *
 * Two round trips rather than a PostgREST embed. The embed would be one query,
 * but it also makes the tenant join part of the filter surface, and a filter
 * surface is precisely what must stay small here. Fetching the page of jobs and
 * then the handful of companies they belong to keeps the `status = 'published'`
 * predicate the only thing standing between this function and the whole table.
 */
export async function listPublicJobs(filters: JobFeedFilters = {}): Promise<JobFeed> {
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
    .select(JOB_COLUMNS, { count: 'exact' })
    .eq('status', 'published')

  if (tenantId) query = query.eq('tenant_id', tenantId)
  if (filters.type) query = query.eq('employment_type', filters.type)
  if (filters.workplace) query = query.eq('workplace', filters.workplace)

  if (filters.q) {
    /*
     * PostgREST's `or` takes a comma-separated list, and a comma or a parenthesis
     * inside the term would end the clause early and change which columns are
     * searched. Stripped rather than escaped: this is a search box, and a term
     * containing `(` is not a query anyone is trying to run.
     */
    const term = filters.q.replace(/[,()*\\]/g, ' ').trim().slice(0, 80)
    if (term) query = query.or(`title.ilike.%${term}%,location.ilike.%${term}%`)
  }

  const { data, count, error } = await query
    .order('published_at', { ascending: false })
    .range(from, from + perPage - 1)

  if (error) {
    console.error('[jobs-public] feed unavailable', error.message)
    return { jobs: [], total: 0, page, perPage }
  }

  const rows = (data ?? []) as unknown as Job[]
  const companies = await loadCompanies(rows)

  return {
    jobs: rows.map((row) => toPublicJob(row, companies.get(row.tenant_id ?? '') ?? PLATFORM_COMPANY)),
    total: count ?? rows.length,
    page,
    perPage,
  }
}

/** One published job, or null. Null covers "draft", "closed" and "never existed"
 *  alike — the portal must not be able to tell an outsider which. */
export async function getPublicJob(id: string): Promise<PublicJob | null> {
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
}

/**
 * A company with at least one live posting, by slug.
 *
 * Returns null for a tenant that has none — an org with nothing published has no
 * public page, which is the difference between a careers page and a directory of
 * every customer this platform has.
 */
export async function getPublicCompany(slug: string): Promise<PublicCompany | null> {
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
}

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
async function loadCompanies(rows: Job[]): Promise<Map<string, PublicCompany>> {
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
