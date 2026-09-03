-- ============================================================================
-- 015_jobs.sql — job postings and the applications they receive.
--
-- THIS IS THE FIRST PUBLIC SURFACE IN THE PRODUCT, and the whole file is shaped
-- by one decision about how that publicity is delivered.
--
-- `anon` STAYS LOCKED DOWN
-- ------------------------
-- 002_rls.sql ends with `revoke all on all tables in schema public from anon`
-- under the comment "Nothing in this product is public: every route is behind a
-- login". A job portal that anyone may read looks, at first, like a reason to
-- grant `anon` a select on `jobs`. It is not. The moment `anon` holds a table
-- privilege, every column added to that table afterwards is readable by the
-- whole internet unless someone remembers to re-revoke it — and the blanket
-- statement above stops being true, which is worse than the hole itself,
-- because the next reader believes it.
--
-- So the public portal never authenticates as `anon` at all. It reads through
-- the SERVICE ROLE from exactly one module, `src/lib/jobs-public.ts`, where
-- every query hard-codes `status = 'published'` and names its columns. That is
-- the same trade 014 made for employee self-onboarding, for the same reason: a
-- filter in one auditable file beats a policy set that has to be read against
-- an unauthenticated caller.
--
-- The policies below therefore exist for the AUTHENTICATED paths — the org's
-- applicant inbox, an employee browsing other companies' openings, the platform
-- console — and those are the paths where RLS is doing real work.
--
-- `jobs.tenant_id` IS NULLABLE, DELIBERATELY
-- ------------------------------------------
-- Every other tenant-scoped table in this schema carries `tenant_id not null`.
-- Here `null` means a PLATFORM job: Oneclickhr hiring for itself, posted by a
-- super admin, who by definition has no tenant (see the profiles constraint in
-- 001). Read `jobs.tenant_id is null` as "Oneclickhr", never as "unscoped".
--
-- THE PRIVACY PROPERTY, and why `job_applications.tenant_id` is denormalised
-- -------------------------------------------------------------------------
-- It is the HIRING tenant, copied from the job at insert. An employee of
-- Company A applying to Company B produces a row scoped to B, so A cannot see
-- that its own staff are job-hunting — not through the policy, not through a
-- join, not by accident. Deriving that column from the applicant instead would
-- invert exactly this, so the denormalisation is load-bearing, not convenience.
--
-- Conventions carried from 010/011: `(select app.is_org())` so zero-argument
-- helpers fold into a one-time InitPlan; row-dependent helpers left unwrapped.
-- ============================================================================

create extension if not exists "pg_trgm";   -- unanchored ilike on the portal search

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.job_type as enum
    ('full_time', 'part_time', 'contract', 'internship', 'temporary');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_workplace as enum ('onsite', 'remote', 'hybrid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status as enum ('draft', 'published', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.application_status as enum
    ('new', 'reviewing', 'shortlisted', 'interviewing', 'offered', 'hired', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id               uuid primary key default gen_random_uuid(),
  -- NULL = a platform job (Oneclickhr's own hiring). See the header.
  tenant_id        uuid references public.tenants(id) on delete cascade,
  posted_by        uuid references public.profiles(id) on delete set null,

  title            text not null check (length(btrim(title)) between 2 and 160),
  description      text not null check (length(btrim(description)) between 20 and 20000),
  responsibilities text check (length(responsibilities) <= 10000),
  requirements     text check (length(requirements) <= 10000),

  department_id    uuid references public.departments(id) on delete set null,
  employment_type  public.job_type      not null default 'full_time',
  workplace        public.job_workplace not null default 'onsite',
  location         text check (length(location) <= 160),

  experience_min   integer check (experience_min between 0 and 60),
  experience_max   integer check (experience_max between 0 and 60),

  -- Money is stored whether or not it is shown. `salary_disclosed` is the switch
  -- the portal reads: an org may record a band for its own planning and still
  -- not advertise it, and deleting the numbers to hide them would throw away
  -- information the org meant to keep.
  salary_min       numeric(12,2) check (salary_min >= 0),
  salary_max       numeric(12,2) check (salary_max >= 0),
  salary_currency  text not null default 'INR' check (salary_currency ~ '^[A-Z]{3}$'),
  salary_period    text not null default 'year'
                     check (salary_period in ('hour', 'day', 'month', 'year')),
  salary_disclosed boolean not null default false,

  openings         integer not null default 1 check (openings between 1 and 999),
  skills           jsonb   not null default '[]'::jsonb,

  status           public.job_status not null default 'draft',
  published_at     timestamptz,
  closes_at        date,

  -- Maintained by trigger. The applicant table is org-only, so the portal could
  -- never count this with the reads it is allowed to make.
  application_count integer not null default 0,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint jobs_experience_range_ck
    check (experience_min is null or experience_max is null or experience_max >= experience_min),
  constraint jobs_salary_range_ck
    check (salary_min is null or salary_max is null or salary_max >= salary_min),
  -- A platform job has no tenant, so it must at least name the super admin who
  -- posted it; otherwise a row with neither would be an unattributable posting.
  constraint jobs_tenant_posted_ck
    check (tenant_id is not null or posted_by is not null)
);

drop trigger if exists set_updated_at on public.jobs;
create trigger set_updated_at before update on public.jobs
  for each row execute function public.tg_set_updated_at();

-- The portal feed: published, newest first. Partial, because drafts and closed
-- roles are a rounding error next to the rows this index exists to serve.
create index if not exists jobs_published_idx
  on public.jobs (published_at desc)
  where status = 'published';

create index if not exists jobs_tenant_status_idx on public.jobs (tenant_id, status, created_at desc);
create index if not exists jobs_department_idx    on public.jobs (department_id) where department_id is not null;

-- Backs `?q=` on the portal, which is an unanchored ilike. A btree cannot serve
-- '%term%'; a trigram GIN can.
create index if not exists jobs_title_trgm_idx    on public.jobs using gin (title gin_trgm_ops);
create index if not exists jobs_location_trgm_idx on public.jobs using gin (location gin_trgm_ops);

/**
 * `published_at` is set once, by the database, the first time a job goes live.
 *
 * In a route handler this is a step every caller has to remember, and one that
 * gets the un-publish/re-publish path wrong: an org that closes a role and
 * reopens it a week later should keep its original posting date, not vault to
 * the top of the feed. Here it is a fact of the table instead.
 */
create or replace function public.tg_jobs_published_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_published_at on public.jobs;
create trigger jobs_published_at before insert or update on public.jobs
  for each row execute function public.tg_jobs_published_at();

-- ---------------------------------------------------------------------------
-- job_applications
--
-- Holds PII belonging to people who are not users of this product and never
-- agreed to be. That is why the column grants below are narrower than anywhere
-- else in the schema, and why there is no INSERT policy at all.
-- ---------------------------------------------------------------------------
create table if not exists public.job_applications (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references public.jobs(id) on delete cascade,
  -- The HIRING tenant, copied from the job. NULL for a platform job. Read the
  -- privacy note in the header before changing how this is populated.
  tenant_id            uuid references public.tenants(id) on delete cascade,

  full_name            text not null check (length(btrim(full_name)) between 2 and 120),
  email                citext not null,
  phone                text check (length(phone) <= 40),
  location             text check (length(location) <= 160),
  linkedin_url         text check (length(linkedin_url) <= 400),
  portfolio_url        text check (length(portfolio_url) <= 400),
  cover_letter         text check (length(cover_letter) <= 8000),

  -- An R2 object key under the `applications/` prefix, NOT a tenant prefix — see
  -- resumeKey() in src/lib/jobs.ts. `/api/files/view` therefore cannot serve it
  -- to anybody at all, which is exactly the intent.
  resume_key           text,
  resume_name          text,

  years_experience     numeric(4,1) check (years_experience >= 0 and years_experience <= 60),
  current_company      text check (length(current_company) <= 160),
  notice_period        text check (length(notice_period) <= 80),

  -- Set only when the applicant was signed in. Null on the public path.
  applicant_profile_id uuid references public.profiles(id) on delete set null,
  source               text not null default 'public' check (source in ('public', 'internal')),

  status               public.application_status not null default 'new',
  org_notes            text check (length(org_notes) <= 8000),
  reviewed_by          uuid references public.profiles(id) on delete set null,
  reviewed_at          timestamptz,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.job_applications;
create trigger set_updated_at before update on public.job_applications
  for each row execute function public.tg_set_updated_at();

create index if not exists job_applications_job_idx    on public.job_applications (job_id, created_at desc);
create index if not exists job_applications_tenant_idx on public.job_applications (tenant_id, created_at desc);
create index if not exists job_applications_status_idx on public.job_applications (job_id, status);
create index if not exists job_applications_profile_idx
  on public.job_applications (applicant_profile_id, created_at desc)
  where applicant_profile_id is not null;

/*
 * One application per address per role.
 *
 * The cheapest anti-spam control available, and it costs nothing: the second
 * submission fails with 23505, which the apply route turns into "You have
 * already applied to this role". `email` is citext, but the index is spelled
 * with lower() anyway so the guarantee does not quietly depend on the column
 * type staying case-insensitive.
 */
create unique index if not exists job_applications_job_email_uidx
  on public.job_applications (job_id, lower(email::text));

/** Keeps jobs.application_count true without the portal reading the PII table. */
create or replace function public.tg_job_applications_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    update public.jobs set application_count = application_count + 1
     where id = new.job_id;
  elsif tg_op = 'DELETE' then
    update public.jobs set application_count = greatest(application_count - 1, 0)
     where id = old.job_id;
  end if;
  return null;
end;
$$;

drop trigger if exists job_applications_count on public.job_applications;
create trigger job_applications_count after insert or delete on public.job_applications
  for each row execute function public.tg_job_applications_count();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.jobs             enable row level security;
alter table public.job_applications enable row level security;

/*
 * Three readers, and the third one is the feature.
 *
 *   1. a super admin, platform-wide (read-only, as everywhere else)
 *   2. an org over its OWN jobs — drafts included, which is why this clause
 *      cannot be folded into the third
 *   3. ANY active member of ANY tenant, over PUBLISHED jobs
 *
 * Clause 3 is what lets an employee of Company A see Company B's openings, and
 * it is the one deliberate cross-tenant read in this schema. It is safe because
 * a published job is already world-readable through the portal: this grants a
 * signed-in employee nothing an anonymous visitor cannot see anyway.
 */
drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
  or (status = 'published' and (select app.is_active_member()))
);

/*
 * Writes are the org's own tenant, full stop.
 *
 * Platform jobs (tenant_id is null) are NOT writable here — a super admin's RLS
 * bypass in this codebase is read-only, so /api/super/jobs goes through the
 * service role like every other super-admin mutation. `with check` repeats the
 * `using` clause so a job cannot be handed to another tenant on the way out.
 */
drop policy if exists jobs_write on public.jobs;
create policy jobs_write on public.jobs for all to authenticated
using      (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

/*
 * Applications: the hiring org, the platform, or the applicant about themselves.
 *
 * Note what is NOT here — the employing tenant of an internal applicant. See the
 * privacy note in the header: `tenant_id` is the hiring side, so this policy has
 * no way to leak a job hunt back to someone's current employer.
 */
drop policy if exists job_applications_select on public.job_applications;
create policy job_applications_select on public.job_applications for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
  or applicant_profile_id = (select auth.uid())
);

/*
 * NO INSERT POLICY, deliberately.
 *
 * Every application — anonymous or from a signed-in employee — is written by the
 * service role in POST /api/jobs/apply. That route is where the résumé bytes get
 * sniffed, the rate limit is spent and the honeypot is checked, and none of
 * those can be expressed as a policy. One writer means one place to audit. Same
 * reasoning as `profiles`, which no session may insert into either.
 */
drop policy if exists job_applications_update on public.job_applications;
create policy job_applications_update on public.job_applications for update to authenticated
using      (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

drop policy if exists job_applications_delete on public.job_applications;
create policy job_applications_delete on public.job_applications for delete to authenticated
using (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

-- ---------------------------------------------------------------------------
-- Column privileges on job_applications — the outer wall
--
-- `job_applications_update` says WHICH ROW an org may edit. It cannot say WHICH
-- COLUMN, and the columns here are not the org's to write: an applicant's name,
-- their cover letter, the key of the file they uploaded. Without this grant an
-- ordinary org session could PATCH `cover_letter` through PostgREST and rewrite
-- what a candidate said about themselves — in a record that may later be
-- evidence in a hiring dispute.
--
-- Postgres checks column privileges before it reaches a policy, so the revoked
-- columns are not "guarded" here, they are invisible to `authenticated`.
-- Table-level UPDATE covers every column and revoking one does not subtract from
-- it, so the only way to say "these and no others" is to drop the table grant and
-- re-grant the list. Same pattern as the domain columns in 013.
--
-- WRITABLE: the triage fields, plus `updated_at` — `tg_set_updated_at` is an
-- invoker-rights trigger, so without that grant every status change would fail.
-- ---------------------------------------------------------------------------
revoke update on public.job_applications from authenticated;
grant update (status, org_notes, reviewed_by, reviewed_at, updated_at)
  on public.job_applications to authenticated;

-- ---------------------------------------------------------------------------
-- The anon lockdown, restated.
--
-- 002_rls.sql's blanket revoke ran before these tables existed, and Supabase's
-- default privileges hand `anon` a fresh grant on everything created in `public`
-- afterwards. Without these two lines, the newest and most public-facing tables
-- in the schema would be the only ones `anon` holds a privilege on.
--
-- Nothing breaks by removing it: the portal reads with the service role (header).
-- ---------------------------------------------------------------------------
revoke all on public.jobs             from anon;
revoke all on public.job_applications from anon;

analyze public.jobs;
analyze public.job_applications;
