-- ============================================================================
-- 033_expenses.sql — what the organization spends, and what is left over.
--
-- The product could already say what a workspace BILLED (invoices) and what it
-- paid people (payment_confirmations). It could not say what either of those
-- meant, because there was nothing on the other side of the subtraction.
--
-- WHAT THIS ADDS
--
--   expenses            One line of spend: an amount, a date, a category, and
--                       optionally a receipt. The ledger.
--
--   recurring_expenses  A RULE that mints those lines — "Figma, $45, the 1st of
--                       every month". Software subscriptions, rent and
--                       insurance are the majority of a small company's
--                       outgoings and none of them are worth re-typing twelve
--                       times a year.
--
--   tenants.default_currency
--                       Because a total is a lie without one. See below.
--
-- SALARIES ARE NOT ROWS HERE, ON PURPOSE.
--
-- Payroll is the largest expense any of these workspaces has, so the obvious
-- move is to copy each `payment_confirmations` row into `expenses`. Don't. That
-- is double-entry bookkeeping done by hand: the copy can be edited, deleted or
-- miss an update, and then two screens in the same product disagree about what
-- payroll cost — with no way to tell which one is wrong. Payroll is DERIVED at
-- read time from the confirmations that already exist (see src/lib/expenses.ts)
-- and shown alongside these rows. One fact, one home.
--
-- THE AUTO-EXPENSE GUARANTEE is the same one 004's header argues for and the
-- visa reminders implement: not "check whether we already made it" — a
-- check-then-insert is a race two overlapping cron runs both pass — but a
-- UNIQUE INDEX the second run loses. `(recurring_id, recurring_period)` is that
-- index. `recurring_period` is the first of the month the line belongs to, so a
-- rule can generate at most one expense per month no matter how many times the
-- job runs, retries, or is triggered by hand.
--
-- DAY OF MONTH IS CAPPED AT 28, which looks arbitrary and is not: 29, 30 and 31
-- do not exist in every month, and a rule set to the 31st would silently skip
-- February, April, June, September and November. Capping the input is honest;
-- "the 31st, except when there isn't one" is a footnote nobody reads.
--
-- MONEY IS NEVER SUMMED ACROSS CURRENCIES. Adding 100 USD to 100 INR gives 200
-- of nothing. Rows carry their own currency, totals are computed per currency,
-- and the dashboard reports in `tenants.default_currency` while saying plainly
-- when there is spend it has left out. A conversion would need a rate, a rate
-- needs a date and a source, and a wrong rate is worse than an honest omission.
--
-- VISIBILITY IS ORG-ONLY. An employee has no business reading the company's
-- outgoings, and payroll expenses would leak colleagues' salaries. There is no
-- employee-facing policy on either table — not a narrow one, none.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Enums
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.expense_category as enum
    ('payroll', 'software', 'rent', 'utilities', 'travel', 'marketing',
     'equipment', 'professional_services', 'taxes', 'insurance', 'other');
exception when duplicate_object then null; end $$;

-- Where the row came from. `manual` was typed by a person; `recurring` was
-- minted by a rule. Kept so the ledger can explain itself — a line nobody
-- remembers entering is a line somebody will delete.
do $$ begin
  create type public.expense_source as enum ('manual', 'recurring');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. tenants.default_currency
--
-- Defaults to USD to match `invoices.currency`, which has defaulted to USD
-- since 001 — so a workspace that never touches this setting sees its existing
-- invoices and its new expenses counted in the same unit.
-- ---------------------------------------------------------------------------

alter table public.tenants
  add column if not exists default_currency text not null default 'USD';

do $$ begin
  alter table public.tenants add constraint tenants_default_currency_ck
    check (default_currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null; end $$;

/*
 * 013 revoked blanket SELECT/UPDATE on `tenants` and re-granted them column by
 * column, so a column added afterwards is INVISIBLE to a session until it is
 * named here. See the note at 013_domain_verification.sql:158.
 */
grant select (default_currency) on public.tenants to authenticated;
grant update (default_currency) on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- 2. recurring_expenses — the rules
--
-- Created BEFORE `expenses` because the ledger references it.
-- ---------------------------------------------------------------------------

create table if not exists public.recurring_expenses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (description is null or length(description) <= 2000),
  category     public.expense_category not null default 'other',
  vendor       text check (vendor is null or length(vendor) <= 200),
  amount       numeric(14,2) not null check (amount > 0 and amount <= 99999999999.99),
  currency     text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- See the header: 1-28 so the rule fires in every month of every year.
  day_of_month smallint not null default 1 check (day_of_month between 1 and 28),
  start_date   date not null default current_date,
  -- Null means "until somebody turns it off". An annual contract sets a date.
  end_date     date,
  is_active    boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint recurring_expenses_dates_ck check (end_date is null or end_date >= start_date)
);

-- The target of the composite foreign key below. Redundant against the primary
-- key on its own, but a foreign key can only reference a UNIQUE column set.
create unique index if not exists recurring_expenses_id_tenant_uq
  on public.recurring_expenses (id, tenant_id);

create index if not exists recurring_expenses_tenant_active_idx
  on public.recurring_expenses (tenant_id, is_active);

-- The index the cron job scans: every active rule across every tenant, in one
-- pass, without a sequential scan of rules that are switched off.
create index if not exists recurring_expenses_due_idx
  on public.recurring_expenses (day_of_month) where is_active;

drop trigger if exists set_updated_at on public.recurring_expenses;
create trigger set_updated_at before update on public.recurring_expenses
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. expenses — the ledger
-- ---------------------------------------------------------------------------

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (description is null or length(description) <= 2000),
  category     public.expense_category not null default 'other',
  vendor       text check (vendor is null or length(vendor) <= 200),
  amount       numeric(14,2) not null check (amount > 0 and amount <= 99999999999.99),
  currency     text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  spent_on     date not null default current_date,
  -- An R2 object key, never a URL. Same convention as payslips and documents:
  -- the bucket is private and /api/files/view is the only read path.
  receipt_url  text check (receipt_url is null or length(receipt_url) <= 300),

  source       public.expense_source not null default 'manual',

  /*
   * COMPOSITE foreign key, as 018 established. A single-column reference only
   * asks whether the rule EXISTS, never whose it is — which is how a rule in
   * tenant A ends up owning a line in tenant B. This binds every writer,
   * including the service role the cron job runs as.
   *
   * ON DELETE SET NULL, not CASCADE: deleting the "Figma subscription" rule
   * must not erase the eleven payments already made under it. The lines stay,
   * orphaned and intact, which is what a ledger is for.
   */
  recurring_id uuid,
  /*
   * The month this line belongs to, as its first day — the idempotency key for
   * auto-generation. Null for anything typed by a person.
   */
  recurring_period date,

  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint expenses_recurring_fk
    foreign key (recurring_id, tenant_id)
    references public.recurring_expenses (id, tenant_id) on delete set null,

  -- The two halves of "generated by a rule" travel together or not at all.
  constraint expenses_recurring_period_ck
    check ((recurring_period is null) = (source <> 'recurring')),
  constraint expenses_recurring_period_first_ck
    check (recurring_period is null or extract(day from recurring_period) = 1)
);

/*
 * THE GUARANTEE. Not a check the job performs — a constraint it loses. Two
 * overlapping cron runs both insert; the second gets 23505, skips, and moves
 * on. Holds across restarts, retries, and a run triggered by hand.
 */
create unique index if not exists expenses_recurring_period_uq
  on public.expenses (recurring_id, recurring_period)
  where recurring_id is not null;

-- The shape of nearly every read: this tenant, newest spend first.
create index if not exists expenses_tenant_spent_idx
  on public.expenses (tenant_id, spent_on desc);

-- The category breakdown on the dashboard.
create index if not exists expenses_tenant_category_idx
  on public.expenses (tenant_id, category, spent_on);

drop trigger if exists set_updated_at on public.expenses;
create trigger set_updated_at before update on public.expenses
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS — org-only, on both tables
--
-- No employee policy exists. `expenses` carries payroll and vendor spend, and
-- the absence of a policy is the strongest possible statement of that: there is
-- no narrow case to get wrong later.
-- ---------------------------------------------------------------------------

alter table public.recurring_expenses enable row level security;
alter table public.expenses           enable row level security;
alter table public.recurring_expenses force row level security;
alter table public.expenses           force row level security;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
);

drop policy if exists expenses_write on public.expenses;
create policy expenses_write on public.expenses for all to authenticated
using  (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

drop policy if exists recurring_expenses_select on public.recurring_expenses;
create policy recurring_expenses_select on public.recurring_expenses
for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
);

drop policy if exists recurring_expenses_write on public.recurring_expenses;
create policy recurring_expenses_write on public.recurring_expenses
for all to authenticated
using  (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

-- ---------------------------------------------------------------------------
-- 5. Auto-generation
--
-- One function, called by /api/cron/auto-expenses once a day. It lives in SQL
-- rather than in the route for the same reason the visa ledger does: the insert
-- and the constraint that makes it idempotent belong in the same place, and a
-- set-based insert does in one statement what a loop over every tenant would do
-- in thousands of round trips.
--
-- `p_today` is passed in rather than read from now(), so the caller can run it
-- per tenant timezone — "the 1st" means the 1st where the org is.
-- ---------------------------------------------------------------------------

create or replace function public.generate_due_expenses(p_today date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_period  date := date_trunc('month', p_today)::date;
  v_created integer;
begin
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
         -- The nominal date of the charge, not the date the job noticed it. A
         -- run that is a day late still books the line on the 1st.
         greatest(v_period + (r.day_of_month - 1), r.start_date),
         'recurring',
         r.id,
         v_period,
         r.created_by
    from public.recurring_expenses r
   where r.is_active
     -- Due: the day has arrived this month, and the rule is inside its window.
     and v_period + (r.day_of_month - 1) <= p_today
     and r.start_date <= p_today
     and (r.end_date is null or r.end_date >= v_period + (r.day_of_month - 1))
  -- The unique index does the deciding. This clause only keeps the statement
  -- from failing when some of the rows in the batch are already there.
  on conflict (recurring_id, recurring_period) where recurring_id is not null
  do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$fn$;

/*
 * Only the cron endpoint may call this. It is SECURITY DEFINER and writes
 * across every tenant, so leaving the default PUBLIC grant in place would let
 * any signed-in user trigger a platform-wide write from PostgREST. The service
 * role is granted back explicitly — `revoke ... from public` takes the implicit
 * grant away from it too, and the job runs as that role.
 */
revoke execute on function public.generate_due_expenses(date) from anon, authenticated, public;
grant execute on function public.generate_due_expenses(date) to service_role;

comment on function public.generate_due_expenses(date) is
  'Mint this month''s expenses for every due recurring rule. Idempotent via expenses_recurring_period_uq.';
