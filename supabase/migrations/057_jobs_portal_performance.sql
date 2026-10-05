-- ============================================================================
-- 057_jobs_portal_performance.sql
--
-- The public job portal, made to scale. Nothing here changes what the portal
-- shows or who may see it — only what the database has to do to answer it.
--
--   1. COUNTRY COUNTS IN SQL. The switcher used to read up to 5000 published
--      rows into Node on EVERY request — including every filter click — and
--      tally them in a Map. It is a `group by`, and now it is one.
--
--   2. INDEXES FOR THE FILTERS THAT EXIST. 015 indexed `published_at` and 052
--      added `country`. The portal also filters by employment type and
--      workplace and still orders by `published_at`, so those get the same
--      partial composite treatment: drafts and closed roles are a rounding
--      error next to the rows these exist to serve.
--
--   3. TRIGRAMS FOR THE COLUMNS `?q=` ACTUALLY SEARCHES. 015's comment says the
--      search box is backed by trigram GIN — but it only built two of the four
--      columns the query names. `client_name` and `description` were sequential
--      scans on every search. Postgres will BitmapOr across the four.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The country switcher, as an aggregate.
-- ---------------------------------------------------------------------------

/**
 * Every country with at least one live posting, most postings first.
 *
 * SECURITY DEFINER because `anon` has no privilege on `public.jobs` (002) and
 * this product is not about to grant one — see the header of src/lib/jobs-public.ts.
 * The function is therefore written so that it CANNOT return anything else:
 * no parameters, no status argument, `status = 'published'` hard-coded, and the
 * only columns that leave it are a two-letter country code and a count. Execute
 * is granted to `service_role` alone, which is the role the portal reads with.
 */
create or replace function public.public_job_country_counts()
returns table (country text, job_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select j.country::text, count(*)::bigint
  from public.jobs j
  where j.status = 'published'
    and j.country is not null
  group by j.country
  order by count(*) desc, j.country asc
$$;

revoke all on function public.public_job_country_counts() from public;
revoke all on function public.public_job_country_counts() from anon;
revoke all on function public.public_job_country_counts() from authenticated;
grant execute on function public.public_job_country_counts() to service_role;

-- ---------------------------------------------------------------------------
-- 2. The feed's filter columns.
-- ---------------------------------------------------------------------------

-- `?type=` and `?mode=`, both of which still sort by published_at. Partial on
-- the published rows, like jobs_published_idx and jobs_country_published_idx.
create index if not exists jobs_type_published_idx
  on public.jobs (employment_type, published_at desc)
  where status = 'published';

create index if not exists jobs_workplace_published_idx
  on public.jobs (workplace, published_at desc)
  where status = 'published';

-- /jobs/company/[slug] — one employer's openings, newest first.
create index if not exists jobs_tenant_published_idx
  on public.jobs (tenant_id, published_at desc)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- 3. The two trigram indexes 015 described but did not build.
-- ---------------------------------------------------------------------------

-- `?q=` is `title ilike %t% or location ilike %t% or client_name ilike %t% or
-- description ilike %t%`. Without these two the OR degrades to a seq scan of
-- every published row no matter how selective the term is.
create index if not exists jobs_client_name_trgm_idx
  on public.jobs using gin (client_name gin_trgm_ops);

create index if not exists jobs_description_trgm_idx
  on public.jobs using gin (description gin_trgm_ops);

-- The planner cannot choose any of the above until it knows the new shape.
analyze public.jobs;
