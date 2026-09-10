-- ============================================================================
-- 026_payment_confirmations.sql — payroll runs in ADP, so what this product
-- collects is PROOF OF RECEIPT.
--
-- THE DIRECTION OF THE UPLOAD REVERSES.
--
-- `payslips` (001) had the org uploading a PDF for each employee to read. But
-- these organizations run payroll in ADP: the money reaches the employee
-- automatically on payday, and the org already has its own records. What nobody
-- has is confirmation, in one place, that each person actually RECEIVED it.
--
--     before:  org uploads a payslip     -> employee reads it
--     after:   employee uploads proof    -> org verifies it
--
-- `payslips` IS NOT DROPPED. Payslips already uploaded are real records that
-- employees can still open, and deleting a customer's documents to tidy up a
-- schema is not a trade worth making. The org's upload control goes away in the
-- UI; the historical rows stay readable.
--
-- One row per employee per month is the whole model. `status` distinguishes
-- "we are waiting for this" from "they sent it" from "we checked it", which is
-- what makes a monthly chase list possible.
--
-- Re-runnable.
-- ============================================================================

do $$ begin
  create type public.payment_confirmation_status as enum
    ('pending', 'submitted', 'verified', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.payment_confirmations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  employee_id  uuid not null,

  -- The pay period this confirms. Kept as two integers rather than a date so
  -- the unique constraint below reads as what it is: one per person per month.
  month        smallint not null check (month between 1 and 12),
  year         smallint not null check (year between 2000 and 2100),

  -- What they were actually paid. Optional: some people will upload the
  -- document and not retype the figure, and a missing amount is better than a
  -- wrong one.
  amount       numeric(14,2) check (amount is null or amount >= 0),
  currency     text check (currency is null or currency ~ '^[A-Z]{3}$'),
  paid_on      date,

  -- An R2 object key, never a public URL — same rule as payslips.
  file_url     text,
  file_name    text check (file_name is null or length(file_name) <= 255),
  note         text check (note is null or length(note) <= 2000),

  status       public.payment_confirmation_status not null default 'pending',
  review_note  text check (review_note is null or length(review_note) <= 2000),

  uploaded_by  uuid references public.profiles(id) on delete set null,
  verified_by  uuid references public.profiles(id) on delete set null,
  verified_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint payment_confirmations_employee_fk
    foreign key (employee_id, tenant_id) references public.profiles (id, tenant_id) on delete cascade,
  constraint payment_confirmations_period_uq unique (tenant_id, employee_id, year, month),
  -- Anything past `pending` has to have the document attached to it. A
  -- "submitted" confirmation with no proof is just a claim.
  constraint payment_confirmations_file_ck
    check (status = 'pending' or file_url is not null)
);

create index if not exists payment_confirmations_period_idx
  on public.payment_confirmations (tenant_id, year desc, month desc, status);
create index if not exists payment_confirmations_employee_idx
  on public.payment_confirmations (tenant_id, employee_id, year desc, month desc);

drop trigger if exists set_updated_at on public.payment_confirmations;
create trigger set_updated_at before update on public.payment_confirmations
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — the employee owns the upload, the org owns the verdict.
-- ---------------------------------------------------------------------------
alter table public.payment_confirmations enable row level security;

drop policy if exists payment_confirmations_select on public.payment_confirmations;
create policy payment_confirmations_select on public.payment_confirmations
for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or employee_id = (select auth.uid()))
  )
);

drop policy if exists payment_confirmations_insert on public.payment_confirmations;
create policy payment_confirmations_insert on public.payment_confirmations
for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  -- The org may open a row (to record that one is expected); an employee may
  -- only ever create their OWN.
  and ((select app.is_org()) or employee_id = (select auth.uid()))
);

drop policy if exists payment_confirmations_update on public.payment_confirmations;
create policy payment_confirmations_update on public.payment_confirmations
for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or employee_id = (select auth.uid()))
)
with check (tenant_id = (select app.current_tenant_id()));

drop policy if exists payment_confirmations_delete on public.payment_confirmations;
create policy payment_confirmations_delete on public.payment_confirmations
for delete to authenticated
using (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

-- ---------------------------------------------------------------------------
-- The employee may not mark their own receipt verified.
--
-- Same shape of rule as the timesheet guard: RLS says which rows you may touch,
-- and this says which columns you may move and to what. Without it the verify
-- button is decorative, because the row is one the employee is allowed to
-- update.
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
    -- Their own upload: they may attach the document and say what they were
    -- paid, and that is all. The verdict is not theirs.
    if new.status is distinct from old.status and new.status not in ('pending', 'submitted') then
      raise exception 'Only your organization can verify a payment confirmation';
    end if;
    if new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at
       or new.review_note is distinct from old.review_note then
      raise exception 'Only your organization can review a payment confirmation';
    end if;
    -- A verified record is settled. Re-uploading over it would silently
    -- invalidate a check somebody already performed.
    if old.status = 'verified' then
      raise exception 'This payment has already been verified and can no longer be changed';
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
