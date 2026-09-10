-- ============================================================================
-- 025_tracking_mode.sql — not every employee clocks in, and not every employee
-- files a timesheet.
--
-- Salaried office staff punch a clock. Contractors placed at a vendor file a
-- weekly sheet. Nobody does both, and asking a person to do the one that does
-- not apply to them is how a feature gets ignored and then distrusted.
--
--     clock_in  — the shift toggle. No timesheets.
--     timesheet — the weekly sheet. No clock.
--     none      — neither. Directors, advisors, anyone whose hours we do not
--                 track at all.
--     NULL      — NOBODY HAS DECIDED. Everything stays visible and permitted,
--                 exactly as it was before this migration existed.
--
-- THE COLUMN IS NULLABLE AND HAS NO DEFAULT, AND THAT IS THE WHOLE POINT.
--
-- The first cut of this migration was `not null default 'clock_in'`, which
-- reads harmlessly and is not. Every employee in every workspace would have
-- been silently declared a clock-in user on the day it ran — Timesheets and
-- Sheet would have disappeared from their sidebar, and `POST /api/timesheets`
-- would have started refusing them, without one organization having chosen
-- anything. A migration must not decide a policy question on a customer's
-- behalf, and "how does this person record their time" is a policy question.
--
-- So: null unless somebody says otherwise, and the application treats null as
-- unrestricted (src/lib/auth/context.ts, src/components/shell/nav-config.ts).
--
-- The one exception is the backfill in §2, which infers a mode only where the
-- data already proves it beyond doubt.
--
-- Re-runnable.
-- ============================================================================

do $$ begin
  create type public.tracking_mode as enum ('clock_in', 'timesheet', 'none');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. The columns
--
-- `default_tracking_mode` is nullable for the same reason: an org that has not
-- opened Settings has expressed no preference, and inventing one for them would
-- hand every new employee a restriction nobody asked for.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists tracking_mode public.tracking_mode;

alter table public.tenants
  add column if not exists default_tracking_mode public.tracking_mode;

-- ---------------------------------------------------------------------------
-- 2. Backfill ONLY where the answer is already a fact
--
-- Somebody who has filed a timesheet demonstrably files timesheets. That is not
-- a guess, it is a record, and setting their mode from it saves an org the work
-- of assigning what the data already says.
--
-- The reverse inference is NOT made. Plenty of people have attendance rows and
-- timesheets, or attendance rows because that was the only option available to
-- them — so "has clocked in" proves nothing about whether they should be barred
-- from timesheets. Those rows stay null, and an org decides.
--
-- `where tracking_mode is null` makes a second run a no-op and, more
-- importantly, means this can never overwrite a choice somebody has made.
-- ---------------------------------------------------------------------------
update public.profiles p
   set tracking_mode = 'timesheet'
 where p.tracking_mode is null
   and p.role = 'employee'
   and exists (
     select 1 from public.timesheets t where t.employee_id = p.id
   );

-- Lets the org-side Attendance and Timesheets lists show only the people the
-- screen is actually about. Partial: an unassigned employee is not a candidate
-- for either filter.
create index if not exists profiles_tracking_mode_idx
  on public.profiles (tenant_id, tracking_mode)
  where is_active and tracking_mode is not null;

-- ---------------------------------------------------------------------------
-- 3. An employee may not change their own mode.
--
-- `tg_profiles_guard` already polices the columns a person must not set on
-- themselves (role, tenant, employee_code and so on). Tracking mode joins that
-- list: someone who could flip their own mode could switch off the clock they
-- are supposed to be punching.
--
-- This is 002's function with `tracking_mode` added to the self-service
-- forbidden list and nothing else changed. The rest is reproduced verbatim:
-- re-deriving it is how the "an org cannot mint roles" rule goes missing.
-- ---------------------------------------------------------------------------
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  -- Server-side/service-role paths (no end user in the request) already
  -- re-verify tenant_id in application code; let them through.
  if auth.uid() is null then
    return new;
  end if;

  -- Nobody may move a profile between tenants, ever.
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable';
  end if;

  if app.is_org() and old.tenant_id = app.current_tenant_id() then
    -- An org manages its people but cannot mint roles (that would let it create
    -- another org or a super admin inside its tenant).
    if new.role is distinct from old.role then
      raise exception 'role changes are not permitted from the client';
    end if;
    return new;
  end if;

  if auth.uid() = old.id then
    -- Self-service edits: contact details, photo, timezone, their own
    -- onboarding answers, and clearing the forced-password-change flag.
    -- Everything else is privileged.
    if new.role          is distinct from old.role
       or new.is_active  is distinct from old.is_active
       or new.employee_code is distinct from old.employee_code
       or new.designation   is distinct from old.designation
       or new.department_id is distinct from old.department_id
       or new.date_of_joining is distinct from old.date_of_joining
       -- (025) Somebody who could flip their own mode could switch off the
       -- clock they are supposed to be punching.
       or new.tracking_mode is distinct from old.tracking_mode then
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
