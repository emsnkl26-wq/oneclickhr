-- ============================================================================
-- 050_pay_schedule.sql — monthly and twice-monthly pay.
--
-- US employees are paid twice a month (the 1st–15th, and the 16th to the end
-- of the month); Indian employees once a month. Payroll still runs outside
-- this product (026) — what changes is how many payment confirmations each
-- person owes per month, and which half of the month each one covers.
--
--   profiles.pay_schedule          'monthly' | 'semi_monthly' | NULL
--       NULL = automatic: the onboarding pay frequency when it says one of
--       these, else the employee's country (US → semi_monthly), else monthly.
--       The rule lives in src/lib/pay-schedule.ts.
--
--   payment_confirmations.period   0 | 1 | 2
--       0 = the whole month           (monthly)
--       1 = the 1st to the 15th       (semi-monthly, first half)
--       2 = the 16th to month end     (semi-monthly, second half)
--
-- One confirmation per person per (year, month, period). A month is either
-- whole or halved for one person, never both — enforced below — so switching
-- somebody's schedule cannot double-count a month that is already confirmed.
--
-- ALSO FIXED HERE: re-uploading a confirmation the org had RETURNED always
-- failed. The upload clears the old review (review_note, verified_*), and
-- 026's guard refused any change to those columns from the employee — so the
-- one path a rejection exists to prompt was a guaranteed error. The employee
-- may now CLEAR them (never set them), exactly like the timesheet guard.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The schedule, per person.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists pay_schedule text;

do $$ begin
  alter table public.profiles add constraint profiles_pay_schedule_ck
    check (pay_schedule is null or pay_schedule in ('monthly', 'semi_monthly'));
exception when duplicate_object then null; end $$;

comment on column public.profiles.pay_schedule is
  'monthly | semi_monthly | NULL (automatic — see src/lib/pay-schedule.ts). 050.';

-- ---------------------------------------------------------------------------
-- 2. The half of the month a confirmation covers.
-- ---------------------------------------------------------------------------
alter table public.payment_confirmations
  add column if not exists period smallint not null default 0;

do $$ begin
  alter table public.payment_confirmations add constraint payment_confirmations_period_ck
    check (period in (0, 1, 2));
exception when duplicate_object then null; end $$;

-- The old one-per-month key becomes one-per-period.
alter table public.payment_confirmations
  drop constraint if exists payment_confirmations_period_uq;
alter table public.payment_confirmations
  add constraint payment_confirmations_period_uq
  unique (tenant_id, employee_id, year, month, period);

/**
 * A month is whole OR halved for one person, never both. Checked on insert and
 * on any change of period, month or year — a SECURITY DEFINER read so it sees
 * the rows whatever the caller's policies are.
 */
create or replace function public.tg_payment_confirmations_period()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.period = old.period and new.month = old.month and new.year = old.year then
    return new;
  end if;

  if exists (
    select 1 from public.payment_confirmations c
     where c.tenant_id   = new.tenant_id
       and c.employee_id = new.employee_id
       and c.year        = new.year
       and c.month       = new.month
       and c.id         <> new.id
       and ((new.period = 0 and c.period <> 0) or (new.period <> 0 and c.period = 0))
  ) then
    raise exception 'This month is already confirmed on a different pay schedule'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$fn$;

drop trigger if exists payment_confirmations_period on public.payment_confirmations;
create trigger payment_confirmations_period
  before insert or update on public.payment_confirmations
  for each row execute function public.tg_payment_confirmations_period();

-- ---------------------------------------------------------------------------
-- 3. The review guard: 026's rules, plus
--      • the period an upload is for cannot be moved by the employee,
--      • the employee may CLEAR an old review when re-uploading (never set one).
-- ---------------------------------------------------------------------------
create or replace function public.tg_payment_confirmations_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.employee_id is distinct from old.employee_id then
    raise exception 'A payment confirmation cannot be moved to another employee or workspace';
  end if;

  if auth.uid() = old.employee_id and not app.is_org() then
    -- A verified record is settled. Re-uploading over it would silently
    -- invalidate a check somebody already performed.
    if old.status = 'verified' then
      raise exception 'This payment has already been verified and can no longer be changed';
    end if;
    if new.status is distinct from old.status and new.status not in ('pending', 'submitted') then
      raise exception 'Only your organization can verify a payment confirmation';
    end if;
    if new.year is distinct from old.year
       or new.month is distinct from old.month
       or new.period is distinct from old.period then
      raise exception 'A payment confirmation cannot be moved to another pay period';
    end if;
    -- The verdict is not theirs to write — but a fresh upload after a return
    -- legitimately wipes the old one.
    if (new.verified_by is distinct from old.verified_by and new.verified_by is not null)
       or (new.verified_at is distinct from old.verified_at and new.verified_at is not null)
       or (new.review_note is distinct from old.review_note and new.review_note is not null) then
      raise exception 'Only your organization can review a payment confirmation';
    end if;
    return new;
  end if;

  if app.is_org() and old.tenant_id = app.current_tenant_id() then
    return new;
  end if;

  raise exception 'Not permitted';
end;
$fn$;

drop trigger if exists payment_confirmations_guard on public.payment_confirmations;
create trigger payment_confirmations_guard before update on public.payment_confirmations
  for each row execute function public.tg_payment_confirmations_guard();

-- ---------------------------------------------------------------------------
-- 4. The schedule is the org's to set, not the employee's: 027's profile guard
--    with `pay_schedule` added to the self-service blacklist.
-- ---------------------------------------------------------------------------
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable';
  end if;

  -- Ownership is server-owned on EVERY client path, org included.
  if new.is_owner is distinct from old.is_owner then
    raise exception 'Workspace ownership is managed by the server';
  end if;

  if app.is_org() and old.tenant_id = app.current_tenant_id() then
    if new.role is distinct from old.role then
      raise exception 'role changes are not permitted from the client';
    end if;
    return new;
  end if;

  if auth.uid() = old.id then
    if new.role          is distinct from old.role
       or new.is_active  is distinct from old.is_active
       or new.employee_code is distinct from old.employee_code
       or new.designation   is distinct from old.designation
       or new.department_id is distinct from old.department_id
       or new.date_of_joining is distinct from old.date_of_joining
       or new.tracking_mode is distinct from old.tracking_mode
       or new.pay_schedule  is distinct from old.pay_schedule then
      raise exception 'You are not allowed to modify these profile fields';
    end if;
    return new;
  end if;

  raise exception 'Not permitted';
end;
$fn$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

notify pgrst, 'reload schema';
