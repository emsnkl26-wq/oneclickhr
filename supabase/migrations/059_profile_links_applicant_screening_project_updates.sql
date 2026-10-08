-- ============================================================================
-- NextKinLife EMS — 059
--
-- Four unrelated additions, in one migration because they are all additive and
-- all re-runnable:
--
-- 1. profiles.linkedin_url — a LinkedIn address on EVERY profile, not just a
--    candidate's. The job dialog used to ask a recruiter for theirs on every
--    posting; now it is a property of the person and the dialog prefills it.
--
-- 2. job_applications.country / .visa_status — the two things a reviewer
--    screens on before opening a CV, as structured values rather than prose
--    buried in `location`.
--
-- 3. project_updates — progress notes on a project, written by the people
--    actually on it. Somebody who clocks in and out files no timesheets, so
--    before this there was no way for them to say what moved.
--
-- 4. catch_up_recurring_expenses() — the tenant-scoped, self-healing half of
--    the recurring-expense job. See its own header for why it exists.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A LinkedIn address on every profile
-- ---------------------------------------------------------------------------
-- No guard change is needed in `tg_profiles_guard` (002_rls.sql): that trigger
-- names the columns a person may NOT change about themselves, and a link to
-- their own professional profile is self-service like `phone` beside it.
alter table public.profiles
  add column if not exists linkedin_url text;

do $$ begin
  alter table public.profiles
    add constraint profiles_linkedin_url_len_ck
    check (linkedin_url is null or length(linkedin_url) <= 400);
exception when duplicate_object then null; end $$;

comment on column public.profiles.linkedin_url is
  'The person''s own LinkedIn address. Prefills the recruiter contact on a job posting.';

-- ---------------------------------------------------------------------------
-- 2. What a reviewer screens an applicant on
-- ---------------------------------------------------------------------------
-- `location` stays exactly as it was — free text, and still the line a person
-- writes about where they live. `country` is the SAME fact in a form that can
-- be filtered and compared, which prose cannot be.
alter table public.job_applications
  add column if not exists country text;

alter table public.job_applications
  add column if not exists visa_status text;

do $$ begin
  -- ISO-3166-1 alpha-2, the spelling every other country column in this schema
  -- uses (jobs.country, candidate_profiles.country).
  alter table public.job_applications
    add constraint job_applications_country_ck
    check (country is null or country ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.job_applications
    add constraint job_applications_visa_status_len_ck
    check (visa_status is null or length(visa_status) <= 80);
exception when duplicate_object then null; end $$;

comment on column public.job_applications.country is
  'ISO-3166-1 alpha-2 country the applicant is based in. Screening field.';
comment on column public.job_applications.visa_status is
  'Work authorization as the applicant stated it, e.g. "H-1B", "Citizen". Screening field.';

-- ---------------------------------------------------------------------------
-- 3. project_updates — progress, from the people on the project
-- ---------------------------------------------------------------------------
-- WHO MAY WRITE ONE is the whole design. An org admin may always; an employee
-- may only on a project they are assigned to OR one they manage. The project
-- manager case is the reason this table exists: a manager who clocks in and out
-- rather than filing timesheets had nowhere to record that anything happened,
-- and `is_project_member` alone would not have let them in, because managing a
-- project is not the same row as being assigned to one.
--
-- `tenant_id` is carried on the row and tied to the project by a composite
-- foreign key (018-style), so an update is structurally unable to point at a
-- project in another workspace.
create table if not exists public.project_updates (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 4000),
  -- Optional. Null means "a note, with no claim about completeness" — which is
  -- most notes, and is why this is not `not null default 0`: a default would
  -- silently report every project as 0% done.
  progress   smallint check (progress is null or progress between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  alter table public.project_updates
    add constraint project_updates_project_fk
    foreign key (project_id, tenant_id)
    references public.projects (id, tenant_id)
    on delete cascade;
exception when duplicate_object then null; end $$;

create index if not exists project_updates_project_idx
  on public.project_updates (project_id, created_at desc);

create index if not exists project_updates_tenant_idx
  on public.project_updates (tenant_id, created_at desc);

drop trigger if exists set_updated_at on public.project_updates;
create trigger set_updated_at before update on public.project_updates
  for each row execute function public.tg_set_updated_at();

/**
 * Does the caller MANAGE this project?
 *
 * Separate from `app.is_project_member`, which asks about `project_assignments`.
 * A manager is named on the project row itself and is frequently not assigned
 * to it, so the two questions have different answers and both have to be asked.
 */
create or replace function app.manages_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project_id and p.manager_id = auth.uid()
  );
$$;

revoke all on function app.manages_project(uuid) from anon, public;
grant execute on function app.manages_project(uuid) to authenticated, service_role;

/*
 * A MANAGER CAN SEE THE PROJECT THEY MANAGE.
 *
 * 010's `projects_select` admits an employee only via `app.is_project_member`,
 * and 040 added `manager_id` on the reasoning that a manager would also be
 * assigned. That holds most of the time and fails silently when it does not:
 * the project is named after them, and the page 404s. Adding the manager test
 * widens the policy by exactly one person per project — the one already written
 * on the row — and is what lets them file the progress notes below.
 */
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and (
      (select app.is_org())
      or app.is_project_member(id)
      or manager_id = (select auth.uid())
    )
  )
);

alter table public.project_updates enable row level security;

-- Read: anyone who can see the project can see what has been said about it.
-- The membership test deliberately mirrors `projects_select`.
drop policy if exists project_updates_select on public.project_updates;
create policy project_updates_select on public.project_updates for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and (
      (select app.is_org())
      or app.is_project_member(project_id)
      or app.manages_project(project_id)
    )
  )
);

-- Write: your own note, on a project you are actually on. `author_id` is pinned
-- to the caller in the policy itself, so there is no request body that files a
-- note under a colleague's name.
drop policy if exists project_updates_insert on public.project_updates;
create policy project_updates_insert on public.project_updates for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and author_id = (select auth.uid())
  and (
    (select app.is_org())
    or app.is_project_member(project_id)
    or app.manages_project(project_id)
  )
);

-- Edit and delete: the author's own note, or the org's housekeeping. An
-- employee cannot touch a colleague's update even on a project they share.
drop policy if exists project_updates_update on public.project_updates;
create policy project_updates_update on public.project_updates for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or author_id = (select auth.uid()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or author_id = (select auth.uid()))
);

drop policy if exists project_updates_delete on public.project_updates;
create policy project_updates_delete on public.project_updates for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or author_id = (select auth.uid()))
);

grant select, insert, update, delete on public.project_updates to authenticated;

comment on table public.project_updates is
  'Progress notes on a project, written by its members, its manager or the org.';

-- ---------------------------------------------------------------------------
-- 4. Recurring expenses that book themselves, without waiting for the cron
-- ---------------------------------------------------------------------------
/**
 * Book every recurring line this tenant is owed, for the last `p_months`
 * periods, and say how many rows that created.
 *
 * WHY THIS EXISTS ALONGSIDE `generate_due_expenses()`. That function is the
 * platform-wide daily job, and it does exactly one period: the month of the
 * date it is handed. Both properties were a problem in practice:
 *
 *   • It is driven by an EXTERNAL scheduler (cron-job.org — see 004's header).
 *     If that schedule is not set up, or is paused, or the endpoint 500s for a
 *     few days, no line is ever booked — so a rule the admin created shows as
 *     an active auto expense while the month's total quietly omits it. The
 *     numbers were wrong, and nothing on the screen said why.
 *   • Because it only ever does the current month, a gap in the schedule is
 *     permanent. The missed months do not come back on the next run.
 *
 * So this is the same insert, scoped to ONE tenant and looped over a short
 * window of recent periods, cheap enough to call when the expenses page loads.
 * The scheduled job stays: it is what books the line ON the day for a workspace
 * nobody happens to open.
 *
 * SAFE TO CALL FROM A BROWSER SESSION, which `generate_due_expenses()` is not:
 *   • The tenant comes from `app.current_tenant_id()`, never from an argument,
 *     so there is no parameter that reaches another workspace's rules.
 *   • `app.is_org()` gates it, so an employee cannot mint ledger rows.
 *   • Idempotent for the same reason the daily job is — the unique index
 *     `expenses_recurring_period_uq` decides, and the insert does nothing on
 *     conflict. Calling it on every page view is boring, which is the point.
 *
 * ON `expenses` AND `force row level security` (033). That table forces RLS, so
 * a SECURITY DEFINER function does not get a free pass on it just by being
 * definer-rights. This is fine for the same reason `generate_due_expenses()` is
 * fine — it performs this identical insert under identical rights — and it
 * would hold even if the policies did apply here, because the only caller is an
 * org administrator inserting into their OWN tenant, which is exactly what
 * `expenses_write` permits.
 */
create or replace function public.catch_up_recurring_expenses(
  p_today  date default null,
  p_months integer default 12
)
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_today   date;
  v_months  integer := least(greatest(coalesce(p_months, 12), 1), 36);
  v_period  date;
  v_created integer := 0;
  v_rows    integer;
begin
  -- No workspace, or not its administrator: nothing to do, and deliberately
  -- not an error — this is called as a side effect of loading a page.
  if v_tenant is null or not app.is_org() then
    return 0;
  end if;

  -- The caller passes the date in the TENANT'S zone ("the 1st" has to mean the
  -- 1st where the org is). `current_date` here is the database's, which is a
  -- fallback, not the intent.
  v_today := coalesce(p_today, current_date);

  for i in reverse v_months - 1 .. 0 loop
    v_period := (date_trunc('month', v_today) - make_interval(months => i))::date;

    insert into public.expenses (
      tenant_id, title, description, category, vendor, amount, currency,
      spent_on, source, recurring_id, recurring_period, created_by
    )
    select r.tenant_id,
           r.title,
           r.description,
           r.category,
           r.vendor,
           r.amount,
           r.currency,
           -- The nominal date of the charge, not the date it was noticed. A
           -- line booked late still lands on its own day of the month, which is
           -- what keeps it inside the month the stats are totalling.
           greatest(v_period + (r.day_of_month - 1), r.start_date),
           'recurring',
           r.id,
           v_period,
           r.created_by
      from public.recurring_expenses r
     where r.tenant_id = v_tenant
       and r.is_active
       -- Due: the day has arrived, and the rule is inside its own window.
       and v_period + (r.day_of_month - 1) <= v_today
       and r.start_date <= v_today
       /*
        * THE RULE MUST HAVE EXISTED IN THIS PERIOD.
        *
        * `generate_due_expenses()` has no equivalent of this line and does not
        * need one — it only ever looks at the CURRENT month, so a rule that
        * has started at all has started by then. Looping over past periods
        * makes that assumption false: without this test, a rule created in
        * June would be back-dated into January through May as well, inventing
        * five months of spend the organization never committed to.
        *
        * `<` the start of the NEXT month, rather than `<= v_period`, so a rule
        * that starts part-way through a period is still booked for it — which
        * is the behaviour the daily job already has, and the `greatest()`
        * above is what puts the charge on the start date rather than before it.
        */
       and r.start_date < (v_period + interval '1 month')
       and (r.end_date is null or r.end_date >= v_period + (r.day_of_month - 1))
    on conflict (recurring_id, recurring_period) where recurring_id is not null
    do nothing;

    get diagnostics v_rows = row_count;
    v_created := v_created + v_rows;
  end loop;

  return v_created;
end;
$fn$;

revoke execute on function public.catch_up_recurring_expenses(date, integer) from anon, public;
grant execute on function public.catch_up_recurring_expenses(date, integer) to authenticated, service_role;

comment on function public.catch_up_recurring_expenses(date, integer) is
  'Book this tenant''s due recurring expenses for recent periods. Org-only, idempotent, safe to call on page load.';

notify pgrst, 'reload schema';
