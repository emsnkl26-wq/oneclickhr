-- ============================================================================
-- 049_overtime.sql — weekly overtime: claimed on the timesheet, approved by a
-- manager, paid and billed at a higher rate.
--
-- THE RULE (the US FLSA default, configurable per workspace):
--
--     overtime hours = billable hours in the week above the weekly threshold
--                      (40 unless the workspace says otherwise)
--     regular hours  = the rest
--
-- Billable hours, because billable hours are what this product pays and bills
-- on (023): a non-billable internal hour was never going to be paid at the
-- placement's rate, so it cannot be paid at 1.5× it either.
--
-- THE FLOW
--   1. The employee fills the week as always. The split is computed by the
--      database from the grid, so the "overtime" figure on a timesheet is a
--      fact about the hours, not a number anyone typed.
--   2. On review, the manager approves all of the overtime, part of it, or
--      none. `approved_overtime_hours` records the decision.
--   3. At approval the pay is fixed (as before, 023), now as
--          regular hours × pay rate
--        + approved OT × pay rate × the placement's OT pay multiplier.
--      Overtime the manager declined is neither paid nor billed.
--   4. An invoice built from approved weeks bills overtime on its own line at
--      bill rate × the placement's OT bill multiplier.
--
-- Only HOURLY placements with `overtime_eligible` get overtime. A salaried
-- (monthly / yearly) or day-rate placement has no hourly rate to multiply, and
-- an exempt employee is not owed overtime at all; for them the hours are all
-- regular, exactly as before this migration.
--
-- ALSO CLOSED HERE — the timesheet row's money and totals are now computed by
-- the database and cannot be written by the employee who owns the row. Until
-- now an employee could PATCH their own open timesheet's `total_hours`,
-- `billable_hours` or even `pay_amount` straight through the REST API; the
-- guard only policed `status`. The guard below recomputes the totals from the
-- entry rows on every write and pins every money / review column to its
-- previous value for the owner's session.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The workspace's threshold. NULL switches overtime off entirely.
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists overtime_weekly_threshold numeric(5,2) default 40;

do $$ begin
  alter table public.tenants add constraint tenants_overtime_threshold_ck
    check (overtime_weekly_threshold is null
           or (overtime_weekly_threshold > 0 and overtime_weekly_threshold <= 168));
exception when duplicate_object then null; end $$;

comment on column public.tenants.overtime_weekly_threshold is
  'Billable hours per week above which hours count as overtime (049). NULL = no overtime.';

-- `tenants` is granted column by column since 013 (see 036 for what forgetting
-- this costs): members read the threshold to show the split, the org edits it
-- — RLS's tenants_update policy still limits that to its own row.
grant select (overtime_weekly_threshold) on public.tenants to authenticated;
grant update (overtime_weekly_threshold) on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Per placement: is this person owed overtime, and at what multiple.
-- ---------------------------------------------------------------------------
alter table public.employee_assignments
  add column if not exists overtime_eligible        boolean not null default true,
  add column if not exists overtime_pay_multiplier  numeric(4,2) not null default 1.5,
  add column if not exists overtime_bill_multiplier numeric(4,2) not null default 1.5;

do $$ begin
  alter table public.employee_assignments add constraint employee_assignments_ot_pay_ck
    check (overtime_pay_multiplier between 1 and 5);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.employee_assignments add constraint employee_assignments_ot_bill_ck
    check (overtime_bill_multiplier between 1 and 5);
exception when duplicate_object then null; end $$;

-- The employee's own view of their placement gains the PAY half of overtime
-- (never the bill multiplier — the same rule as 022's pay_rate / bill_rate
-- split). CREATE OR REPLACE, appending columns only, so the view is otherwise
-- exactly 022's: read that header before changing it.
create or replace view public.my_assignments
with (security_barrier = true) as
select
  a.id,
  a.tenant_id,
  a.employee_id,
  a.vendor_id,
  v.name as vendor_name,
  a.client_id,
  c.name as client_name,
  a.project_id,
  a.pay_rate,
  a.pay_currency,
  a.rate_unit,
  a.start_date,
  a.end_date,
  a.is_primary,
  a.status,
  a.overtime_eligible,
  a.overtime_pay_multiplier
from public.employee_assignments a
left join public.vendors v on v.id = a.vendor_id and v.tenant_id = a.tenant_id
left join public.clients c on c.id = a.client_id and c.tenant_id = a.tenant_id
where a.employee_id = (select auth.uid());

revoke all on public.my_assignments from anon, public;
grant select on public.my_assignments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The timesheet's overtime.
-- ---------------------------------------------------------------------------
alter table public.timesheets
  add column if not exists overtime_hours          numeric(7,2) not null default 0,
  add column if not exists approved_overtime_hours numeric(7,2),
  add column if not exists overtime_pay_amount     numeric(14,2);

do $$ begin
  alter table public.timesheets add constraint timesheets_overtime_ck
    check (overtime_hours >= 0
           and (approved_overtime_hours is null
                or (approved_overtime_hours >= 0 and approved_overtime_hours <= overtime_hours))
           and (overtime_pay_amount is null or overtime_pay_amount >= 0));
exception when duplicate_object then null; end $$;

comment on column public.timesheets.overtime_hours is
  'Billable hours above the workspace threshold, computed from the grid (049).';
comment on column public.timesheets.approved_overtime_hours is
  'How much of overtime_hours the reviewer approved. NULL until reviewed (049).';

-- ---------------------------------------------------------------------------
-- 4. The guard: 023's rules, verbatim, plus
--      • totals recomputed from the grid on every write,
--      • overtime recomputed while the week is still undecided,
--      • money and review columns pinned for the owner's own session.
-- ---------------------------------------------------------------------------
create or replace function public.tg_timesheets_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_total     numeric;
  v_billable  numeric;
  v_threshold numeric;
begin
  /*
   * TOTALS ARE THE GRID'S. Recomputed here, on every insert and update, from
   * the entry rows — so no session, whatever it sends, can make the header
   * disagree with the lines. `tg_timesheet_rollup` still fires on entry
   * changes; it now simply touches the row and this computes the same answer.
   */
  select coalesce(sum(public.timesheet_entry_hours(e)), 0),
         coalesce(sum(public.timesheet_entry_hours(e)) filter (where e.billable), 0)
    into v_total, v_billable
    from public.timesheet_entries e
   where e.timesheet_id = new.id;

  new.total_hours        := v_total;
  new.billable_hours     := v_billable;
  new.non_billable_hours := v_total - v_billable;

  /*
   * OVERTIME follows the grid until the week is approved, then freezes with the
   * pay that was fixed from it. A workspace that later changes its threshold
   * must not rewrite what an approved week was paid for.
   */
  if tg_op = 'INSERT' or old.status is distinct from 'approved' then
    select t.overtime_weekly_threshold into v_threshold
      from public.tenants t where t.id = new.tenant_id;
    new.overtime_hours := case
      when v_threshold is null then 0
      else greatest(0, v_billable - v_threshold)
    end;
  else
    new.overtime_hours := old.overtime_hours;
  end if;

  -- 023: a week being submitted has to say what was learned in it.
  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from 'submitted')
     and (new.weekly_learnings is null or btrim(new.weekly_learnings) = '') then
    raise exception 'Weekly learnings are required before a timesheet can be submitted'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    /*
     * An employee creating their own week starts it clean: no pay, no review,
     * no invoice. RLS already forces status = 'open' for them.
     */
    if auth.uid() is not null and auth.uid() = new.employee_id then
      new.pay_rate_snapshot       := null;
      new.pay_amount              := null;
      new.pay_currency            := null;
      new.approved_overtime_hours := null;
      new.overtime_pay_amount     := null;
      new.invoice_id              := null;
      new.invoiced_at             := null;
      new.reviewed_by             := null;
      new.reviewed_at             := null;
      new.review_note             := null;
    end if;
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

    /*
     * The money and the decision are not the employee's to write. Pinned to
     * what they were — except that resubmitting may CLEAR an old review, which
     * is exactly what the save route does when a rejected week goes back in.
     */
    new.pay_rate_snapshot       := old.pay_rate_snapshot;
    new.pay_amount              := old.pay_amount;
    new.pay_currency            := old.pay_currency;
    new.approved_overtime_hours := old.approved_overtime_hours;
    new.overtime_pay_amount     := old.overtime_pay_amount;
    new.invoice_id              := old.invoice_id;
    new.invoiced_at             := old.invoiced_at;
    if new.reviewed_by is not null then new.reviewed_by := old.reviewed_by; end if;
    if new.reviewed_at is not null then new.reviewed_at := old.reviewed_at; end if;
    if new.review_note is not null then new.review_note := old.review_note; end if;
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

-- ---------------------------------------------------------------------------
-- 5. Backfill the split for weeks not yet approved. Runs with no auth.uid(),
--    so the guard takes the server path; approved weeks keep 0, which is what
--    they were paid on.
-- ---------------------------------------------------------------------------
update public.timesheets t
   set overtime_hours = greatest(0, t.billable_hours - tn.overtime_weekly_threshold)
  from public.tenants tn
 where tn.id = t.tenant_id
   and tn.overtime_weekly_threshold is not null
   and t.status <> 'approved';
