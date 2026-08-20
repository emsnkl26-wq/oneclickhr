-- ============================================================================
-- 009_performance.sql — make the database keep up as tenants grow.
--
-- Nothing here changes what anyone is allowed to see. It changes how many times
-- Postgres has to work it out, and how it finds the rows once it has.
--
-- Three parts:
--   1. RLS predicates hoisted out of the per-row loop.
--   2. Indexes for the lookups the app actually performs.
--   3. Aggregates that belong in the database, not in a Node process.
--
-- Safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. RLS: evaluate the session helpers ONCE per statement, not once per row
-- ---------------------------------------------------------------------------
--
-- THE PROBLEM. A policy written as
--
--     using (tenant_id = app.current_tenant_id() and app.is_org())
--
-- calls both functions for EVERY ROW the statement examines. They are marked
-- STABLE, which permits Postgres to cache them — but only per call site, and it
-- still has to make the call. `app.is_active_member()` runs an EXISTS over
-- profiles ⋈ tenants; on a 2,000-row scan that is 2,000 extra index lookups to
-- re-derive an answer that cannot change during the statement.
--
-- THE FIX. Wrapping a zero-argument call in a scalar subquery —
--
--     using (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
--
-- turns it into an InitPlan: evaluated once, before the scan starts, and the
-- result substituted as a constant. Same predicate, same answer, one call.
--
-- This is applied by rewriting the deparsed policy expressions rather than by
-- retyping thirty policies, so the semantics are carried over verbatim and this
-- migration cannot silently disagree with 002_rls.sql. Only ZERO-ARGUMENT calls
-- are hoisted: `app.is_task_assignee(tasks.id)` depends on the row and must stay
-- exactly where it is.
do $$
declare
  rec       record;
  new_qual  text;
  new_check text;
  statement text;
  changed   integer := 0;
begin
  -- Deparsing qualifies anything outside the search_path, which is what keeps
  -- `app.*` and `auth.*` recognisable to the patterns below.
  set local search_path = public, pg_catalog;

  for rec in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
  loop
    -- Normalise first: strip any wrapper a previous run of this migration
    -- added, so re-running cannot nest `(select (select ...))`.
    new_qual := regexp_replace(
      coalesce(rec.qual, ''),
      '\( SELECT (app\.[a-z_]+\(\)|auth\.(uid|jwt|role)\(\))\)',
      '\1', 'g'
    );
    new_check := regexp_replace(
      coalesce(rec.with_check, ''),
      '\( SELECT (app\.[a-z_]+\(\)|auth\.(uid|jwt|role)\(\))\)',
      '\1', 'g'
    );

    -- `\(\)` in the pattern is deliberate: it matches only calls that take no
    -- arguments, which are the only ones that are constant for the statement.
    new_qual := regexp_replace(
      new_qual, '(app\.[a-z_]+\(\)|auth\.(uid|jwt|role)\(\))', '( SELECT \1)', 'g'
    );
    new_check := regexp_replace(
      new_check, '(app\.[a-z_]+\(\)|auth\.(uid|jwt|role)\(\))', '( SELECT \1)', 'g'
    );

    if new_qual = coalesce(rec.qual, '') and new_check = coalesce(rec.with_check, '') then
      continue;
    end if;

    statement := format('alter policy %I on %I.%I', rec.policyname, rec.schemaname, rec.tablename);
    if rec.qual is not null then
      statement := statement || format(' using (%s)', new_qual);
    end if;
    if rec.with_check is not null then
      statement := statement || format(' with check (%s)', new_check);
    end if;

    execute statement;
    changed := changed + 1;
  end loop;

  raise notice '[009] hoisted session helpers in % RLS policies', changed;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Indexes for the queries this application actually runs
-- ---------------------------------------------------------------------------

-- /api/files/view is the hottest authenticated route in the product: every
-- avatar in a 200-row employee table is one request, and for an EMPLOYEE each
-- one asks "does a row I am allowed to see reference this object key?" against
-- four tables. Without these that is four sequential scans per image.
create index if not exists documents_file_url_idx
  on public.documents (file_url);
create index if not exists payslips_file_url_idx
  on public.payslips (file_url);
create index if not exists work_auth_document_url_idx
  on public.work_authorizations (document_url)
  where document_url is not null;
create index if not exists tenants_logo_url_idx
  on public.tenants (logo_url)
  where logo_url is not null;

-- The employees list: tenant + role, newest first. The existing
-- (tenant_id, role) index cannot serve the ORDER BY, so every page load sorted
-- the whole result set. This one is a strict superset of it — same leading
-- columns, plus the sort key — so the narrower index is dropped rather than
-- left behind to be maintained on every write for nothing.
create index if not exists profiles_tenant_role_created_idx
  on public.profiles (tenant_id, role, created_at desc);
drop index if exists public.profiles_tenant_role_idx;

-- The employee detail page pulls payslips and documents for ONE person.
create index if not exists payslips_employee_idx
  on public.payslips (employee_id, year desc, month desc);
create index if not exists documents_employee_created_idx
  on public.documents (employee_id, created_at desc)
  where employee_id is not null;

-- "Which notifications has this user read?" — the read list is fetched on every
-- visit to the notifications page. The primary key is (notification_id, user_id),
-- so it cannot answer that; this index can, and covers it, so the query never
-- touches the heap. It also subsumes the existing (user_id) index.
create index if not exists notification_reads_user_notification_idx
  on public.notification_reads (user_id, notification_id);
drop index if exists public.notification_reads_user_idx;

-- Deliberately NOT added, having been checked rather than assumed:
--   • visa_reminder_logs (work_auth_id)  — the UNIQUE (work_auth_id, milestone)
--     constraint already indexes it as the leading column.
--   • meetings (tenant_id, start_time)   — meetings_tenant_start_idx is DESC,
--     and a btree scans backwards just as well.
--   • payslips (tenant_id, year, month)  — payslips_tenant_idx is the same
--     columns; direction is irrelevant to an equality filter.
-- An index that duplicates an existing one is not free: it is write
-- amplification and disk on every insert, in exchange for nothing.

-- ---------------------------------------------------------------------------
-- 3. Work that belongs in the database
-- ---------------------------------------------------------------------------

/**
 * Document search, paged, with the excerpt cut server-side.
 *
 * The documents page used to select `extracted_text` for up to 500 rows and
 * throw away all but the first 4,000 characters in Node. The extracted text of
 * a scanned contract runs to hundreds of kilobytes, so a workspace with a few
 * hundred documents was moving tens of megabytes out of Postgres, across the
 * wire and into a serverless function's heap on every single page view.
 *
 * SECURITY INVOKER (the default, stated here because it is load-bearing): the
 * query runs as the caller, so the documents RLS policy scopes it to their
 * tenant exactly as a direct select would. This function grants no new access.
 *
 * `p_query` is a bound parameter, never string-built, and the full-text branch
 * uses the same `to_tsvector('english', ...)` expression as documents_text_idx
 * so the GIN index is actually used.
 */
create or replace function public.search_documents(
  p_query  text default null,
  p_kind   text default null,
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  id          uuid,
  employee_id uuid,
  kind        text,
  file_url    text,
  file_name   text,
  mime_type   text,
  size_bytes  bigint,
  excerpt     text,
  created_at  timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with term as (
    select nullif(btrim(coalesce(p_query, '')), '') as q
  )
  select
    d.id,
    d.employee_id,
    d.kind::text,
    d.file_url,
    d.file_name,
    d.mime_type,
    d.size_bytes,
    -- Enough for the one line the table shows, and nothing more.
    left(d.extracted_text, 240) as excerpt,
    d.created_at,
    count(*) over () as total_count
  from public.documents d
  cross join term
  where (p_kind is null or d.kind::text = p_kind)
    and (
      term.q is null
      or d.file_name ilike '%' || term.q || '%'
      or to_tsvector('english', coalesce(d.extracted_text, ''))
         @@ websearch_to_tsquery('english', term.q)
    )
  order by d.created_at desc
  limit  least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function public.search_documents(text, text, integer, integer) from anon, public;
grant  execute on function public.search_documents(text, text, integer, integer) to authenticated, service_role;

/**
 * Per-tenant account counts for the platform console.
 *
 * It replaces `select tenant_id, role, is_active from profiles` with no filter —
 * every profile row on the platform, pulled into Node to be counted in a loop.
 * That query gets linearly slower with total customers and is the first thing
 * that would fall over at scale.
 *
 * SECURITY DEFINER and granted to service_role ONLY. It is deliberately
 * cross-tenant, so it must be unreachable from a browser session; the caller is
 * `/super`, which sits behind requireSuperAdmin().
 */
create or replace function public.platform_tenant_stats()
returns table (
  tenant_id uuid,
  employees bigint,
  orgs      bigint,
  inactive  bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.tenant_id,
    count(*) filter (where p.role = 'employee') as employees,
    count(*) filter (where p.role = 'org')      as orgs,
    count(*) filter (where not p.is_active)     as inactive
  from public.profiles p
  where p.tenant_id is not null
  group by p.tenant_id;
$$;

revoke execute on function public.platform_tenant_stats() from anon, authenticated, public;
grant  execute on function public.platform_tenant_stats() to service_role;

-- ---------------------------------------------------------------------------
-- Refresh the planner's statistics for the tables whose access paths changed.
-- ---------------------------------------------------------------------------
analyze public.profiles;
analyze public.documents;
analyze public.payslips;
analyze public.attendance;
analyze public.leaves;
