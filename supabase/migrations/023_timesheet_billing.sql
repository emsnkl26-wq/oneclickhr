-- ============================================================================
-- 023_timesheet_billing.sql — a timesheet learns who it was worked for, what
-- the employee earns from it, and what they learned that week.
--
-- THREE CHANGES, ONE TABLE:
--
--   1. `comments` -> `weekly_learnings`. A rename, not a new column, so every
--      week already filed keeps what was written in it. The field also becomes
--      MANDATORY AT SUBMIT — enforced in the guard trigger below, because a
--      check constraint cannot say "required only in this state".
--
--   2. `vendor_id` / `client_id` / `assignment_id`. Who the week was worked for.
--      Defaulted from the employee's primary assignment when the sheet is
--      opened, changeable by the employee while it is still open.
--
--   3. `pay_amount` — what the EMPLOYEE earns from this week.
--
-- WHAT IS DELIBERATELY *NOT* HERE: the bill amount.
--
-- `timesheets` is readable by the employee who owns it. Putting the billed
-- figure on this table would hand every employee the number 022 exists to keep
-- from them, and no amount of care in the API would undo that. The bill side
-- lives on `invoices` (org-only) and is computed at invoice time from the
-- assignment. Do not add a bill column here.
--
-- The pay figure is SNAPSHOTTED rather than derived on read: a rate that
-- changes in March must not silently rewrite what January's approved week said
-- the person would be paid.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. comments -> weekly_learnings
--
-- Guarded so a second run is a no-op rather than an error, and so it does the
-- right thing whether the column has already moved or not.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'timesheets' and column_name = 'comments'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'timesheets' and column_name = 'weekly_learnings'
  ) then
    alter table public.timesheets rename column comments to weekly_learnings;
    raise notice '[023] timesheets.comments renamed to weekly_learnings';
  end if;
end $$;

alter table public.timesheets
  add column if not exists weekly_learnings text;

-- ---------------------------------------------------------------------------
-- 2. Who the week was worked for
-- ---------------------------------------------------------------------------
alter table public.timesheets
  add column if not exists vendor_id     uuid,
  add column if not exists client_id     uuid,
  add column if not exists assignment_id uuid;

do $$ begin
  alter table public.timesheets add constraint timesheets_vendor_fk
    foreign key (vendor_id, tenant_id) references public.vendors (id, tenant_id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.timesheets add constraint timesheets_client_fk
    foreign key (client_id, tenant_id) references public.clients (id, tenant_id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.timesheets add constraint timesheets_assignment_fk
    foreign key (assignment_id, tenant_id)
    references public.employee_assignments (id, tenant_id) on delete set null;
exception when duplicate_object then null; end $$;

create index if not exists timesheets_vendor_idx
  on public.timesheets (tenant_id, vendor_id, status)
  where vendor_id is not null;

-- ---------------------------------------------------------------------------
-- 3. What the employee earns from this week
--
-- Written by the approval route from the assignment's pay_rate. Null until
-- then, and null forever on a week whose assignment carried no pay rate — an
-- honest "we do not know" beats a confident zero.
-- ---------------------------------------------------------------------------
alter table public.timesheets
  add column if not exists pay_rate_snapshot numeric(12,2)
    check (pay_rate_snapshot is null or pay_rate_snapshot >= 0),
  add column if not exists pay_amount numeric(14,2)
    check (pay_amount is null or pay_amount >= 0),
  add column if not exists pay_currency text
    check (pay_currency is null or pay_currency ~ '^[A-Z]{3}$');

-- ---------------------------------------------------------------------------
-- 4. Weekly learnings become mandatory at SUBMIT
--
-- Not a check constraint: the field is legitimately empty all week while the
-- sheet is `open`, and only has to be filled to move to `submitted`. That is a
-- statement about a TRANSITION, which is a trigger's job.
--
-- The existing column guard (010) already refuses employee self-approval; this
-- extends the same trigger function rather than adding a second one, so there
-- is one place that answers "what may change on a timesheet, and when".
-- ---------------------------------------------------------------------------
-- This is 010's function with ONE rule added at the top and the UPDATE-only
-- body left exactly as it was. The status machine below (who may set what, and
-- from which state) is 010's and is reproduced verbatim — re-deriving it would
-- be how an employee gets to self-approve a week again.
create or replace function public.tg_timesheets_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  /*
   * THE NEW RULE (023): a week being submitted has to say what was learned in
   * it.
   *
   * Checked BEFORE the service-role escape below, and on INSERT as well as
   * UPDATE, because "mandatory" that a server route can skip is not mandatory.
   * There is no legitimate path that files a submitted week with this empty.
   */
  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from 'submitted')
     and (new.weekly_learnings is null or btrim(new.weekly_learnings) = '') then
    raise exception 'Weekly learnings are required before a timesheet can be submitted'
      using errcode = 'check_violation';
  end if;

  -- Everything from here down applies to edits of an existing row only.
  if tg_op = 'INSERT' then
    return new;
  end if;

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
    -- alone, and so does the rollup trigger — testing `new.status` on its own
    -- would reject both of those on a REJECTED sheet, which is the one state
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
$fn$;

drop trigger if exists timesheets_guard on public.timesheets;
create trigger timesheets_guard before insert or update on public.timesheets
  for each row execute function public.tg_timesheets_guard();
