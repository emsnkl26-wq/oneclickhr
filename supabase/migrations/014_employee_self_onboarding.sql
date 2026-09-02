-- ============================================================================
-- NextKinLife EMS — 014_employee_self_onboarding.sql
-- Let the ACCOUNT come first and the paperwork come second.
--
-- WHAT CHANGED, AND WHY
-- ---------------------
-- 008 built the onboarding wizard on one rule: no auth account exists until the
-- org has typed all ~60 fields. That rule is right when the ORG holds the
-- information. It is wrong when the EMPLOYEE does — which is most of it: their
-- address, their visa copy, their bank account, their next of kin. Under 008
-- the org had to collect all of that by email and retype it.
--
-- So the draft grows two more resting places between `draft` and `completed`:
--
--   draft      → the org is filling it in. No account. (008's world, unchanged.)
--   invited    → the account EXISTS and the credentials have been handed over.
--                The employee is filling in the rest.
--   submitted  → the employee has finished. The org has it to review.
--   completed  → reviewed and written onto the profile.
--
-- The employee never touches `profiles` on this path — they edit the DRAFT, and
-- an org admin's approval is what copies it across. That keeps `tg_profiles_guard`
-- (002_rls.sql) exactly as strict as it was: nothing here widens what an
-- employee may write to their own profile.
--
-- NO NEW RLS POLICIES, DELIBERATELY
-- ---------------------------------
-- A draft row carries `internal_notes`, `compliance_notes` and pay — things the
-- subject of the row must not read. Granting the employee row access and then
-- trying to hide columns is the wrong shape (Postgres column privileges are per
-- ROLE, not per row). So the employee's half of this flow goes through route
-- handlers that use the service role and filter on
-- `employee_profile_id = <the caller>`, returning only the fields the employee
-- is allowed to see. `employee_onboarding` stays invisible to `authenticated`
-- employees, exactly as 008 left it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Status — two new resting places.
-- The constraint is dropped and recreated rather than altered: a CHECK cannot
-- be widened in place.
-- ---------------------------------------------------------------------------
alter table public.employee_onboarding
  drop constraint if exists employee_onboarding_status_check;

alter table public.employee_onboarding
  add constraint employee_onboarding_status_check
  check (status in ('draft', 'invited', 'submitted', 'completed', 'cancelled'));

-- ---------------------------------------------------------------------------
-- Timeline columns. All nullable — every one of them is "has this happened yet".
-- ---------------------------------------------------------------------------
alter table public.employee_onboarding add column if not exists invited_at   timestamptz;
alter table public.employee_onboarding add column if not exists submitted_at timestamptz;
alter table public.employee_onboarding add column if not exists reviewed_at  timestamptz;

-- What the org told the employee to fix when it sent the form back. Shown to
-- the employee, so it is deliberately NOT one of the admin-only note columns.
alter table public.employee_onboarding add column if not exists review_notes text;

-- The employee's own position in their (shorter) version of the wizard. A
-- separate column from `current_step` so the org resuming its side and the
-- employee resuming theirs do not shunt each other around.
alter table public.employee_onboarding
  add column if not exists employee_step integer not null default 1;

do $$ begin
  alter table public.employee_onboarding
    add constraint employee_onboarding_employee_step_ck
    check (employee_step between 1 and 6);
exception when duplicate_object then null; end $$;

alter table public.employee_onboarding
  add column if not exists employee_completed_steps jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- The completion invariant, restated for the new statuses.
--
-- 008 said: a `completed` row points at the account it produced. That still
-- holds — and now `invited` and `submitted` must too, because on this path the
-- account is what makes those states meaningful in the first place. Without it
-- there would be nobody able to sign in and fill the form.
-- ---------------------------------------------------------------------------
alter table public.employee_onboarding
  drop constraint if exists employee_onboarding_completed_ck;

alter table public.employee_onboarding
  add constraint employee_onboarding_completed_ck check (
    (status not in ('invited', 'submitted', 'completed') or employee_profile_id is not null)
    and (status <> 'completed' or completed_at is not null)
  );

-- The employee's own lookup — "is there an onboarding waiting for me?" — runs
-- on every visit to their dashboard, so it gets an index rather than a scan.
create index if not exists employee_onboarding_profile_idx
  on public.employee_onboarding (employee_profile_id)
  where employee_profile_id is not null;

-- The org's review queue.
create index if not exists employee_onboarding_review_idx
  on public.employee_onboarding (tenant_id, status, submitted_at desc)
  where status = 'submitted';

-- ---------------------------------------------------------------------------
-- Deleting a draft: unchanged in spirit, narrowed in fact.
--
-- 008 refused to delete a `completed` row so the record of how an account came
-- to exist survives. `invited` and `submitted` rows have an account too, so the
-- same reasoning applies to them — deleting one would orphan a real person who
-- can sign in. Deactivate the employee instead.
-- ---------------------------------------------------------------------------
drop policy if exists employee_onboarding_delete on public.employee_onboarding;
create policy employee_onboarding_delete on public.employee_onboarding
  for delete to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and app.is_org()
    and status in ('draft', 'cancelled')
  );
