-- ============================================================================
-- 052_job_portal_candidates.sql — job seekers get accounts; jobs get a
-- recruiter; applications get a history the applicant can read.
--
-- RUN 051 FIRST (it adds the enum values used here).
--
-- 1. THE CANDIDATE ROLE
--    A person looking for work signs up on the job portal and becomes a
--    `candidate`: no workspace, no tenant, and — because every tenant-scoped
--    policy compares `tenant_id` to the caller's (NULL) tenant — no access to
--    any organization's data. What they CAN reach is their own profile, their
--    own candidate profile, and their own applications.
--
--    THE TRUST BOUNDARY (see 003). A self-signup's role still comes from
--    `raw_app_meta_data`, which only the service role can write; the one thing
--    `raw_user_meta_data` may now do is ask for `signup_as = 'candidate'`.
--    That can only ever LOWER the default self-signup role (`org`, which owns
--    a whole workspace) to one that owns nothing, so an attacker gains nothing
--    by sending it — and an app_meta role, when present, always wins.
--
-- 2. APPLYING NOW REQUIRES AN ACCOUNT
--    The apply route (src/app/api/jobs/apply) refuses a signed-out caller, and
--    links every application to the applicant's profile. That is what lets a
--    candidate come back and see where each application stands.
--
-- 3. RECRUITER CONTACT, and the engagement details US staffing roles are
--    advertised with (client, duration, start, work authorization), on `jobs`.
--    All of it is public by intent once the job is published.
--
-- 4. job_application_events — every status an application passes through, with
--    an optional message to the applicant. Written by a trigger, so the org's
--    ordinary status update is all it takes; readable by the applicant, the
--    hiring org and the platform.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sign-up: let a self-signup ask to be a candidate.
--    003's function, with the one branch added. Nothing else changes.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_app_meta  jsonb := coalesce(new.raw_app_meta_data,  '{}'::jsonb);
  v_user_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role      public.user_role;
  v_tenant    uuid;
  v_must      boolean;
begin
  -- TRUSTED source only. Anything not explicitly stamped by the Admin API is an
  -- ordinary self-signup.
  begin
    v_role := coalesce(nullif(v_app_meta ->> 'app_role', ''), 'org')::public.user_role;
  exception when others then
    v_role := 'org';
  end;

  -- (052) A self-signup from the job portal. Honoured ONLY when no trusted role
  -- was stamped, and it can only turn the default `org` into the strictly less
  -- privileged `candidate` — never the other way.
  if nullif(v_app_meta ->> 'app_role', '') is null
     and v_user_meta ->> 'signup_as' = 'candidate' then
    v_role := 'candidate';
  end if;

  begin
    v_tenant := nullif(v_app_meta ->> 'tenant_id', '')::uuid;
  exception when others then
    v_tenant := null;
  end;

  -- Defensive: a tenant id only ever accompanies an admin-created employee.
  if v_role in ('org', 'super_admin', 'candidate') then
    v_tenant := null;
  end if;

  if v_role = 'employee' and v_tenant is null then
    raise exception 'employee accounts require a tenant_id in app_metadata';
  end if;

  v_must := coalesce((v_app_meta ->> 'must_change_password')::boolean, false);

  insert into public.profiles (id, tenant_id, role, email, full_name, must_change_password)
  values (
    new.id,
    v_tenant,
    v_role,
    new.email,
    nullif(btrim(coalesce(v_user_meta ->> 'full_name', v_user_meta ->> 'name', '')), ''),
    v_must
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

/** An active candidate (052). Candidates have no tenant, so this reads the row. */
create or replace function app.is_candidate()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'candidate' and p.is_active
  );
$$;

revoke execute on function app.is_candidate() from anon, public;
grant execute on function app.is_candidate() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. candidate_profiles — what a job seeker tells employers about themselves,
--    reused to prefill every application. 1:1 with profiles.
-- ---------------------------------------------------------------------------
create table if not exists public.candidate_profiles (
  id                uuid primary key references public.profiles(id) on delete cascade,
  headline          text check (headline is null or length(headline) <= 160),
  phone             text check (phone is null or length(phone) <= 40),
  location          text check (location is null or length(location) <= 160),
  country           text check (country is null or country ~ '^[A-Z]{2}$'),
  linkedin_url      text check (linkedin_url is null or length(linkedin_url) <= 400),
  portfolio_url     text check (portfolio_url is null or length(portfolio_url) <= 400),
  years_experience  numeric(4,1) check (years_experience is null or (years_experience >= 0 and years_experience <= 60)),
  current_company   text check (current_company is null or length(current_company) <= 160),
  notice_period     text check (notice_period is null or length(notice_period) <= 80),
  work_authorization text check (work_authorization is null or length(work_authorization) <= 80),
  skills            jsonb not null default '[]'::jsonb,
  summary           text check (summary is null or length(summary) <= 4000),
  -- Same private prefix as application résumés (`applications/resumes/`), for
  -- the same reason: no tenant owns it, so /api/files/view can never serve it.
  resume_key        text check (resume_key is null or resume_key like 'applications/resumes/%'),
  resume_name       text check (resume_name is null or length(resume_name) <= 255),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.candidate_profiles;
create trigger set_updated_at before update on public.candidate_profiles
  for each row execute function public.tg_set_updated_at();

alter table public.candidate_profiles enable row level security;
alter table public.candidate_profiles force row level security;

drop policy if exists candidate_profiles_select on public.candidate_profiles;
create policy candidate_profiles_select on public.candidate_profiles for select to authenticated
using ((select app.is_super_admin()) or id = (select auth.uid()));

drop policy if exists candidate_profiles_insert on public.candidate_profiles;
create policy candidate_profiles_insert on public.candidate_profiles for insert to authenticated
with check (id = (select auth.uid()) and (select app.is_candidate()));

drop policy if exists candidate_profiles_update on public.candidate_profiles;
create policy candidate_profiles_update on public.candidate_profiles for update to authenticated
using (id = (select auth.uid()) and (select app.is_candidate()))
with check (id = (select auth.uid()));

revoke all on public.candidate_profiles from anon;

-- ---------------------------------------------------------------------------
-- 3. Jobs: recruiter contact and engagement details.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists recruiter_name         text,
  add column if not exists recruiter_title        text,
  add column if not exists recruiter_email        text,
  add column if not exists recruiter_phone        text,
  add column if not exists recruiter_linkedin_url text,
  add column if not exists company_linkedin_url   text,
  add column if not exists client_name            text,
  add column if not exists duration               text,
  add column if not exists start_date_label       text,
  add column if not exists work_authorization     text;

do $$ begin
  alter table public.jobs add constraint jobs_recruiter_len_ck check (
        (recruiter_name         is null or length(recruiter_name)         <= 120)
    and (recruiter_title        is null or length(recruiter_title)        <= 120)
    and (recruiter_email        is null or length(recruiter_email)        <= 254)
    and (recruiter_phone        is null or length(recruiter_phone)        <= 40)
    and (recruiter_linkedin_url is null or length(recruiter_linkedin_url) <= 400)
    and (company_linkedin_url   is null or length(company_linkedin_url)   <= 400)
    and (client_name            is null or length(client_name)            <= 160)
    and (duration               is null or length(duration)               <= 80)
    and (start_date_label       is null or length(start_date_label)       <= 80)
    and (work_authorization     is null or length(work_authorization)     <= 120)
  );
exception when duplicate_object then null; end $$;

-- Links are stored only as https URLs — they are rendered as hrefs on a public
-- page, and a `javascript:` URL there would run in every visitor's browser.
do $$ begin
  alter table public.jobs add constraint jobs_links_https_ck check (
        (recruiter_linkedin_url is null or recruiter_linkedin_url ~* '^https://[^[:space:]]+$')
    and (company_linkedin_url   is null or company_linkedin_url   ~* '^https://[^[:space:]]+$')
  );
exception when duplicate_object then null; end $$;

-- The portal's country switcher.
create index if not exists jobs_country_published_idx
  on public.jobs (country, published_at desc)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- 4. Applications: a message to the applicant, and the history.
-- ---------------------------------------------------------------------------
alter table public.job_applications
  add column if not exists candidate_message text;

do $$ begin
  alter table public.job_applications add constraint job_applications_candidate_message_len_ck
    check (candidate_message is null or length(candidate_message) <= 2000);
exception when duplicate_object then null; end $$;

-- 015 granted UPDATE column by column; the org may now also write the message.
grant update (candidate_message) on public.job_applications to authenticated;

create table if not exists public.job_application_events (
  id                   uuid primary key default gen_random_uuid(),
  application_id       uuid not null references public.job_applications(id) on delete cascade,
  -- Both denormalised from the application, so the read policy is a plain
  -- comparison rather than a join (same reasoning as 015's tenant_id).
  tenant_id            uuid references public.tenants(id) on delete cascade,
  applicant_profile_id uuid references public.profiles(id) on delete set null,
  status               public.application_status not null,
  message              text check (message is null or length(message) <= 2000),
  created_at           timestamptz not null default now()
);

create index if not exists job_application_events_app_idx
  on public.job_application_events (application_id, created_at);
create index if not exists job_application_events_applicant_idx
  on public.job_application_events (applicant_profile_id, created_at desc)
  where applicant_profile_id is not null;

alter table public.job_application_events enable row level security;
alter table public.job_application_events force row level security;

drop policy if exists job_application_events_select on public.job_application_events;
create policy job_application_events_select on public.job_application_events for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
  or applicant_profile_id = (select auth.uid())
);
-- No write policies: only the trigger below writes, as its owner.
revoke all on public.job_application_events from anon;
revoke insert, update, delete on public.job_application_events from authenticated;

create or replace function public.tg_job_application_events()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.job_application_events
      (application_id, tenant_id, applicant_profile_id, status, message)
    values (new.id, new.tenant_id, new.applicant_profile_id, new.status, null);
  elsif new.status is distinct from old.status then
    insert into public.job_application_events
      (application_id, tenant_id, applicant_profile_id, status, message)
    values (
      new.id, new.tenant_id, new.applicant_profile_id, new.status,
      nullif(btrim(coalesce(new.candidate_message, '')), '')
    );
  end if;
  return null;
end;
$$;

drop trigger if exists job_application_events_log on public.job_applications;
create trigger job_application_events_log
  after insert or update on public.job_applications
  for each row execute function public.tg_job_application_events();

-- Existing applications start their history at "received".
insert into public.job_application_events
  (application_id, tenant_id, applicant_profile_id, status, message, created_at)
select a.id, a.tenant_id, a.applicant_profile_id, 'new', null, a.created_at
  from public.job_applications a
 where not exists (
   select 1 from public.job_application_events e where e.application_id = a.id
 );

-- ---------------------------------------------------------------------------
-- 5. What an applicant may see about their own applications.
--
-- SECURITY DEFINER because the job and the company live in tables a candidate
-- has no policy on (they belong to no tenant). The ONLY filter is
-- `applicant_profile_id = auth.uid()`, and the columns are the ones the
-- portal already shows the world about a job — never `org_notes`, never
-- anything about other applicants.
-- ---------------------------------------------------------------------------
create or replace function public.my_job_applications()
returns table (
  id                     uuid,
  job_id                 uuid,
  status                 text,
  candidate_message      text,
  created_at             timestamptz,
  updated_at             timestamptz,
  resume_name            text,
  job_title              text,
  job_status             text,
  job_location           text,
  job_country            text,
  employment_type        text,
  workplace              text,
  company_name           text,
  company_tenant_id      uuid,
  recruiter_name         text,
  recruiter_title        text,
  recruiter_email        text,
  recruiter_phone        text,
  recruiter_linkedin_url text
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select a.id, a.job_id, a.status::text, a.candidate_message, a.created_at, a.updated_at,
         a.resume_name,
         j.title, j.status::text, j.location, j.country,
         j.employment_type::text, j.workplace::text,
         coalesce(t.name, 'Oneclickhr'), j.tenant_id,
         j.recruiter_name, j.recruiter_title, j.recruiter_email, j.recruiter_phone,
         j.recruiter_linkedin_url
    from public.job_applications a
    join public.jobs j on j.id = a.job_id
    left join public.tenants t on t.id = j.tenant_id
   where a.applicant_profile_id = auth.uid()
   order by a.created_at desc
   limit 500;
$$;

revoke execute on function public.my_job_applications() from anon, public;
grant execute on function public.my_job_applications() to authenticated;

notify pgrst, 'reload schema';
