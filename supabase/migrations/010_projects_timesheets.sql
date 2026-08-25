-- ============================================================================
-- 010_projects_timesheets.sql — projects, assignments and weekly timesheets.
--
-- Follows the tenancy model of 001/002 exactly: every table carries a NOT NULL
-- `tenant_id` with an index on it, RLS is enabled, and every membership question
-- is answered by a SECURITY DEFINER helper in the `app` schema so a policy can
-- never re-enter its own table.
--
-- TWO CONVENTIONS CARRIED OVER FROM 009_performance.sql
-- ----------------------------------------------------
--   1. Zero-argument helpers are wrapped in a scalar subquery — `(select
--      app.is_org())` — so Postgres folds them into a one-time InitPlan instead
--      of calling them once per row. 009 rewrote the existing policies to this
--      shape; new policies are WRITTEN in it rather than waiting to be rewritten.
--   2. Helpers that take the row's own id (`app.owns_timesheet(id)`) genuinely
--      depend on the row and are deliberately left unwrapped.
--
-- Safe to run top-to-bottom more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.project_status as enum ('active', 'inactive', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.timesheet_status as enum ('open', 'submitted', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- tenant_sequences — per-tenant counters behind the human-readable ids
-- (PRJ-001, TS-00001, TKT-001).
--
-- WHY NOT A POSTGRES SEQUENCE: a sequence is global, so tenant B's first
-- project would be PRJ-004 because tenant A created three. These ids are shown
-- to customers and quoted back to us in support, so they restart per tenant.
--
-- The `on conflict do update ... returning` below is a single statement, so the
-- row lock it takes makes the increment atomic against concurrent inserts —
-- two people creating a project at the same instant cannot be handed the same
-- number.
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_sequences (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  last_value bigint not null default 0,
  primary key (tenant_id, name)
);

create or replace function public.next_tenant_sequence(p_tenant uuid, p_name text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value bigint;
begin
  insert into public.tenant_sequences as s (tenant_id, name, last_value)
       values (p_tenant, p_name, 1)
  on conflict (tenant_id, name)
    do update set last_value = s.last_value + 1
    returning s.last_value into v_value;
  return v_value;
end;
$$;

/** `PRJ-007`, `TS-00042`. Width is per-series so the columns line up. */
create or replace function public.format_tenant_code(p_prefix text, p_value bigint, p_width integer)
returns text
language sql
immutable
as $$
  select p_prefix || '-' || lpad(p_value::text, p_width, '0');
$$;

-- ---------------------------------------------------------------------------
-- projects
--
-- `client_name` is who the work is billed to; `end_client_name` is who the
-- employee actually sits with. In staffing those are routinely different
-- companies and a timesheet has to be defensible against both.
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  code            text not null,
  name            text not null check (length(btrim(name)) between 1 and 160),
  client_name     text,
  end_client_name text,
  description     text,
  start_date      date,
  end_date        date,
  status          public.project_status not null default 'active',
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint projects_range_ck check (end_date is null or start_date is null or end_date >= start_date),
  constraint projects_code_unique unique (tenant_id, code)
);

drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at before update on public.projects
  for each row execute function public.tg_set_updated_at();

create index if not exists projects_tenant_idx        on public.projects (tenant_id, created_at desc);
create index if not exists projects_tenant_status_idx on public.projects (tenant_id, status);

/** Assign the next per-tenant PRJ- code when the caller did not supply one. */
create or replace function public.tg_projects_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.format_tenant_code(
      'PRJ', public.next_tenant_sequence(new.tenant_id, 'project'), 3
    );
  end if;
  return new;
end;
$$;

drop trigger if exists projects_code on public.projects;
create trigger projects_code before insert on public.projects
  for each row execute function public.tg_projects_code();

-- ---------------------------------------------------------------------------
-- project_assignments — many-to-many. An employee can be on several projects
-- and a project has several people.
-- ---------------------------------------------------------------------------
create table if not exists public.project_assignments (
  project_id  uuid not null references public.projects(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, employee_id)
);

create index if not exists project_assignments_employee_idx on public.project_assignments (employee_id);
create index if not exists project_assignments_tenant_idx   on public.project_assignments (tenant_id);

-- ---------------------------------------------------------------------------
-- timesheets — one per employee per week.
--
-- The week is stored as its OWN two dates rather than being derived at read
-- time. A week is a local calendar idea and the org's timezone can change; a
-- timesheet filed for 18–24 August must keep saying 18–24 August afterwards.
--
-- `total_hours` / `billable_hours` are maintained by a trigger over the entry
-- rows below, so they cannot disagree with the grid the employee filled in.
-- ---------------------------------------------------------------------------
create table if not exists public.timesheets (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  employee_id        uuid not null references public.profiles(id) on delete cascade,
  code               text not null,
  week_start         date not null,
  week_end           date not null,
  status             public.timesheet_status not null default 'open',
  total_hours        numeric(7,2) not null default 0,
  billable_hours     numeric(7,2) not null default 0,
  non_billable_hours numeric(7,2) not null default 0,
  comments           text,
  -- R2 object key + display name for the client's own timesheet export, when
  -- the end client requires one. Never a public URL — same rule as payslips.
  attachment_url     text,
  attachment_name    text,
  submitted_at       timestamptz,
  reviewed_by        uuid references public.profiles(id) on delete set null,
  review_note        text,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint timesheets_week_ck check (week_end = week_start + 6),
  constraint timesheets_code_unique unique (tenant_id, code),
  constraint timesheets_week_unique unique (tenant_id, employee_id, week_start)
);

drop trigger if exists set_updated_at on public.timesheets;
create trigger set_updated_at before update on public.timesheets
  for each row execute function public.tg_set_updated_at();

create index if not exists timesheets_tenant_status_idx on public.timesheets (tenant_id, status, week_start desc);
create index if not exists timesheets_employee_idx      on public.timesheets (employee_id, week_start desc);
create index if not exists timesheets_tenant_week_idx   on public.timesheets (tenant_id, week_start desc);

create or replace function public.tg_timesheets_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.format_tenant_code(
      'TS', public.next_tenant_sequence(new.tenant_id, 'timesheet'), 5
    );
  end if;
  return new;
end;
$$;

drop trigger if exists timesheets_code on public.timesheets;
create trigger timesheets_code before insert on public.timesheets
  for each row execute function public.tg_timesheets_code();

-- ---------------------------------------------------------------------------
-- timesheet_entries — one row per task/project line in the weekly grid.
--
-- Seven numeric columns rather than seven rows: the grid is a fixed week, the
-- UI reads and writes a whole line at once, and the totals below are then a
-- plain sum instead of a pivot.
-- ---------------------------------------------------------------------------
create table if not exists public.timesheet_entries (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  timesheet_id uuid not null references public.timesheets(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  task_name    text,
  billable     boolean not null default true,
  position     integer not null default 0,
  hours_sun    numeric(5,2) not null default 0 check (hours_sun between 0 and 24),
  hours_mon    numeric(5,2) not null default 0 check (hours_mon between 0 and 24),
  hours_tue    numeric(5,2) not null default 0 check (hours_tue between 0 and 24),
  hours_wed    numeric(5,2) not null default 0 check (hours_wed between 0 and 24),
  hours_thu    numeric(5,2) not null default 0 check (hours_thu between 0 and 24),
  hours_fri    numeric(5,2) not null default 0 check (hours_fri between 0 and 24),
  hours_sat    numeric(5,2) not null default 0 check (hours_sat between 0 and 24),
  created_at   timestamptz not null default now()
);

create index if not exists timesheet_entries_sheet_idx   on public.timesheet_entries (timesheet_id, position);
create index if not exists timesheet_entries_project_idx on public.timesheet_entries (project_id);
create index if not exists timesheet_entries_tenant_idx  on public.timesheet_entries (tenant_id);

/** The row's week total — one definition, used by the trigger and the views. */
create or replace function public.timesheet_entry_hours(e public.timesheet_entries)
returns numeric
language sql
immutable
as $$
  select e.hours_sun + e.hours_mon + e.hours_tue + e.hours_wed
       + e.hours_thu + e.hours_fri + e.hours_sat;
$$;

/**
 * Keep the header totals in step with the grid.
 *
 * Recomputed from the entry rows on every change rather than accumulated, so a
 * deleted line, an edited cell and a re-submitted week all converge on the same
 * answer — there is no running total to drift.
 */
create or replace function public.tg_timesheet_rollup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet uuid := coalesce(new.timesheet_id, old.timesheet_id);
begin
  update public.timesheets t
     set total_hours        = coalesce(agg.total, 0),
         billable_hours     = coalesce(agg.billable, 0),
         non_billable_hours = coalesce(agg.total, 0) - coalesce(agg.billable, 0)
    from (
      select
        sum(public.timesheet_entry_hours(e))                            as total,
        sum(public.timesheet_entry_hours(e)) filter (where e.billable)   as billable
        from public.timesheet_entries e
       where e.timesheet_id = v_sheet
    ) agg
   where t.id = v_sheet;

  return null;
end;
$$;

drop trigger if exists timesheet_entries_rollup on public.timesheet_entries;
create trigger timesheet_entries_rollup
  after insert or update or delete on public.timesheet_entries
  for each row execute function public.tg_timesheet_rollup();

/**
 * Column guard for timesheets, in the spirit of `tg_profiles_guard`.
 *
 * RLS decides WHICH ROWS you may update; it cannot say "you may not set this
 * column to that value". Without this an employee could PATCH their own
 * timesheet straight to `approved`, which is the whole point of the feature.
 *
 *   employee — may edit only while OPEN or REJECTED, and may only move the
 *              status to `open` or `submitted`.
 *   org      — reviews. It may not rewrite the hours an employee filed, and it
 *              cannot move a sheet the employee has not submitted.
 */
create or replace function public.tg_timesheets_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  -- Service-role/server paths re-verify tenancy in application code.
  if auth.uid() is null then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.employee_id is distinct from old.employee_id then
    raise exception 'A timesheet cannot be moved to another employee or workspace';
  end if;

  if auth.uid() = old.employee_id then
    if old.status not in ('open', 'rejected') then
      raise exception 'This timesheet has been submitted and can no longer be edited';
    end if;
    -- Only a CHANGE of status is policed. Every ordinary save leaves the status
    -- alone, and so does the rollup trigger below — testing `new.status` on its
    -- own would reject both of those on a REJECTED sheet, which is the one state
    -- where editing is the entire point.
    if new.status is distinct from old.status and new.status not in ('open', 'submitted') then
      raise exception 'You cannot set that status on your own timesheet';
    end if;
    return new;
  end if;

  if app.is_org() and old.tenant_id = app.current_tenant_id() then
    if new.status is distinct from old.status
       and old.status <> 'submitted' then
      raise exception 'Only a submitted timesheet can be approved or rejected';
    end if;
    return new;
  end if;

  raise exception 'Not permitted';
end;
$$;

drop trigger if exists timesheets_guard on public.timesheets;
create trigger timesheets_guard before update on public.timesheets
  for each row execute function public.tg_timesheets_guard();

-- ---------------------------------------------------------------------------
-- app helpers for the policies below
-- ---------------------------------------------------------------------------

/** Is the caller assigned to this project? (Employees see only these.) */
create or replace function app.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.project_assignments pa
     where pa.project_id = p_project_id and pa.employee_id = auth.uid()
  );
$$;

/** Does this timesheet belong to the caller? */
create or replace function app.owns_timesheet(p_timesheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.timesheets t
     where t.id = p_timesheet_id and t.employee_id = auth.uid()
  );
$$;

/**
 * Is this timesheet the caller's AND still theirs to change?
 *
 * The status test lives here rather than in the entry policies so "submitted
 * means frozen" is stated once. Rejected counts as editable — that is the whole
 * point of rejecting instead of deleting.
 */
create or replace function app.timesheet_editable(p_timesheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.timesheets t
     where t.id = p_timesheet_id
       and t.employee_id = auth.uid()
       and t.status in ('open', 'rejected')
  );
$$;

revoke all on all functions in schema app from anon, public;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.projects            enable row level security;
alter table public.project_assignments enable row level security;
alter table public.timesheets          enable row level security;
alter table public.timesheet_entries   enable row level security;
alter table public.tenant_sequences    enable row level security;

-- Deliberately NOT `force row level security`. The rollup trigger below updates
-- `timesheets` from a SECURITY DEFINER function; forcing RLS for the owner would
-- put a policy check in the middle of a total that is already derived from rows
-- the caller was allowed to write. Everything reachable by a browser session is
-- still fully governed by the policies that follow.

-- projects: the org runs them, an assigned employee can see the ones they are on.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or app.is_project_member(id))
  )
);

drop policy if exists projects_write on public.projects;
create policy projects_write on public.projects for all to authenticated
using  (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

-- project_assignments: an employee reads their OWN assignments (that is how the
-- projects list is scoped); only the org writes them.
drop policy if exists project_assignments_select on public.project_assignments;
create policy project_assignments_select on public.project_assignments for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or employee_id = (select auth.uid()) or app.is_project_member(project_id))
  )
);

drop policy if exists project_assignments_write on public.project_assignments;
create policy project_assignments_write on public.project_assignments for all to authenticated
using  (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

-- timesheets
drop policy if exists timesheets_select on public.timesheets;
create policy timesheets_select on public.timesheets for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or employee_id = (select auth.uid()))
  )
);

-- An employee files their own week, and it always starts OPEN. Mirrored by the
-- guard trigger, so there is no shape of request that files a pre-approved week.
drop policy if exists timesheets_insert on public.timesheets;
create policy timesheets_insert on public.timesheets for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    (select app.is_org())
    or (employee_id = (select auth.uid()) and status = 'open')
  )
);

drop policy if exists timesheets_update on public.timesheets;
create policy timesheets_update on public.timesheets for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or employee_id = (select auth.uid()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or employee_id = (select auth.uid()))
);

-- Withdrawing a week you have not submitted. The org can clear anything.
drop policy if exists timesheets_delete on public.timesheets;
create policy timesheets_delete on public.timesheets for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    (select app.is_org())
    or (employee_id = (select auth.uid()) and status in ('open', 'rejected'))
  )
);

-- timesheet_entries: readable with the sheet, writable only while it is open.
drop policy if exists timesheet_entries_select on public.timesheet_entries;
create policy timesheet_entries_select on public.timesheet_entries for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or app.owns_timesheet(timesheet_id))
  )
);

drop policy if exists timesheet_entries_insert on public.timesheet_entries;
create policy timesheet_entries_insert on public.timesheet_entries for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or app.timesheet_editable(timesheet_id))
);

drop policy if exists timesheet_entries_update on public.timesheet_entries;
create policy timesheet_entries_update on public.timesheet_entries for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or app.timesheet_editable(timesheet_id))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or app.timesheet_editable(timesheet_id))
);

drop policy if exists timesheet_entries_delete on public.timesheet_entries;
create policy timesheet_entries_delete on public.timesheet_entries for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or app.timesheet_editable(timesheet_id))
);

-- tenant_sequences: RLS on with ZERO policies, exactly like rate_limits.
--
-- What makes that workable rather than a wall: RLS does not apply to the table
-- OWNER unless FORCE ROW LEVEL SECURITY is set, and it is not. So the SECURITY
-- DEFINER code-assignment triggers — which run as the owner — can bump a counter
-- while a browser session has no route to the table at all.
revoke all on public.tenant_sequences from anon, authenticated;
revoke execute on function public.next_tenant_sequence(uuid, text) from anon, authenticated, public;
grant  execute on function public.next_tenant_sequence(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Saving a week
-- ---------------------------------------------------------------------------

/**
 * Replace a timesheet's lines with exactly what the form holds — atomically.
 *
 * WHY THIS IS NOT TWO POSTGREST CALLS. The grid is saved by clearing the week's
 * rows and writing the new set. Done as a DELETE request followed by an INSERT
 * request, those are two separate transactions: a network failure between them
 * leaves the employee's week emptied, with the hours they just typed gone and no
 * error that explains it. Here the delete and the insert are one statement pair
 * inside one function call, so the week either changes completely or not at all.
 *
 * SECURITY INVOKER (the default, stated because it is load-bearing): every
 * statement below runs as the CALLER, so `timesheet_entries_delete` and
 * `timesheet_entries_insert` govern it exactly as they would a direct write.
 * This function grants no access — in particular it cannot be used to write
 * lines into a submitted sheet, because `app.timesheet_editable()` still gates
 * the insert.
 *
 * `tenant_id` is taken from the PARENT ROW, never from the payload: the caller
 * describes the hours, the database decides whose they are.
 */
create or replace function public.save_timesheet_entries(
  p_timesheet_id uuid,
  p_entries jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_count  integer;
begin
  -- Visible only if the caller may SELECT it, so a foreign id is "not found".
  select t.tenant_id into v_tenant
    from public.timesheets t
   where t.id = p_timesheet_id;

  if v_tenant is null then
    raise exception 'That timesheet was not found';
  end if;

  if jsonb_typeof(coalesce(p_entries, 'null'::jsonb)) <> 'array' then
    raise exception 'Expected an array of entries';
  end if;

  delete from public.timesheet_entries e where e.timesheet_id = p_timesheet_id;

  insert into public.timesheet_entries (
    tenant_id, timesheet_id, project_id, task_name, billable, position,
    hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat
  )
  select
    v_tenant,
    p_timesheet_id,
    nullif(entry ->> 'projectId', '')::uuid,
    nullif(btrim(coalesce(entry ->> 'taskName', '')), ''),
    coalesce((entry ->> 'billable')::boolean, true),
    -- The array's order IS the grid's order, so the lines come back in the
    -- sequence the person arranged them in.
    (ord - 1)::integer,
    coalesce((entry ->> 'hoursSun')::numeric, 0),
    coalesce((entry ->> 'hoursMon')::numeric, 0),
    coalesce((entry ->> 'hoursTue')::numeric, 0),
    coalesce((entry ->> 'hoursWed')::numeric, 0),
    coalesce((entry ->> 'hoursThu')::numeric, 0),
    coalesce((entry ->> 'hoursFri')::numeric, 0),
    coalesce((entry ->> 'hoursSat')::numeric, 0)
  from jsonb_array_elements(p_entries) with ordinality as t(entry, ord);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.save_timesheet_entries(uuid, jsonb) from anon, public;
grant  execute on function public.save_timesheet_entries(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Aggregates that belong in the database
-- ---------------------------------------------------------------------------

/**
 * Approved hours per project.
 *
 * "Total hours on the project" is the sum of every APPROVED timesheet line
 * pointing at it. Derived rather than stored: a rejected-then-approved week, a
 * corrected cell or a deleted line all land on the right number without a
 * counter to repair.
 *
 * SECURITY INVOKER (the default, stated because it is load-bearing): the query
 * runs as the caller, so the timesheet policies above scope it — an org sees
 * the whole tenant, an employee sees only their own contribution.
 */
create or replace function public.project_hour_totals(p_project_id uuid default null)
returns table (project_id uuid, total_hours numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select e.project_id,
         sum(public.timesheet_entry_hours(e))::numeric
    from public.timesheet_entries e
    join public.timesheets t on t.id = e.timesheet_id
   where t.status = 'approved'
     and e.project_id is not null
     and (p_project_id is null or e.project_id = p_project_id)
   group by e.project_id;
$$;

revoke execute on function public.project_hour_totals(uuid) from anon, public;
grant  execute on function public.project_hour_totals(uuid) to authenticated, service_role;

analyze public.projects;
analyze public.timesheets;
analyze public.timesheet_entries;
