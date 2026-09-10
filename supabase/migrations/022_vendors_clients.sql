-- ============================================================================
-- 022_vendors_clients.sql — who we invoice, who the employee sits with, and
-- the two rates that must never be confused with each other.
--
-- THE STAFFING SHAPE
-- ------------------
-- An employee works at an END CLIENT (Microsoft) through a VENDOR (Infosys).
-- We invoice the VENDOR. The vendor pays us. We pay the employee a share.
-- Three parties, two money amounts, and they are not the same number:
--
--     bill_rate  — what the VENDOR is invoiced.     ORG EYES ONLY.
--     pay_rate   — what the EMPLOYEE is paid.       The employee may see this.
--
-- AN EMPLOYEE MUST NEVER BE ABLE TO READ bill_rate.
--
-- That is a requirement about a person's access to a number, so it is enforced
-- by the DATABASE, not by remembering to leave a column out of a `select` in
-- some React component. Two mechanisms, belt and braces:
--
--   1. `employee_assignments` is ORG-ONLY under RLS. An employee session
--      selecting it gets zero rows, whatever columns it asks for.
--   2. Employees read `public.my_assignments` instead — a view that does not
--      HAVE a bill_rate column to leak. There is no query an employee can write
--      against it that produces the number, because the number is not there.
--
-- The view is deliberately not `security_invoker`: it runs as its owner so it
-- can see past the org-only policy in (1), and it carries its own
-- `employee_id = auth.uid()` filter plus `security_barrier` so it can only ever
-- return the caller's own rows. Changing either of those reopens the hole.
--
-- WHY A SEPARATE `employee_assignments` AND NOT COLUMNS ON `projects`
-- ------------------------------------------------------------------
-- `projects` already carries `client_name` / `end_client_name` as free TEXT.
-- That is fine for a label on a project page and useless for money: it cannot
-- carry a rate, cannot be reported on, and spells the same vendor four ways.
-- Those columns stay exactly as they are — this is additive, and nothing that
-- reads them today changes.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.party_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.rate_unit as enum ('hour', 'day', 'month', 'year');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.assignment_status as enum ('active', 'ended');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- vendors — the company we invoice.
-- ---------------------------------------------------------------------------
create table if not exists public.vendors (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  name                text not null check (length(btrim(name)) between 1 and 160),
  contact_name        text check (contact_name is null or length(contact_name) <= 120),
  email               text check (email is null or length(email) <= 200),
  phone               text check (phone is null or length(phone) <= 40),
  -- One jsonb rather than six columns: an invoice prints this as an address
  -- block and never queries inside it.
  address             jsonb not null default '{}'::jsonb,
  -- Drives the invoice due date. 30 is the staffing norm.
  payment_terms_days  integer not null default 30 check (payment_terms_days between 0 and 365),
  notes               text,
  status              public.party_status not null default 'active',
  created_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint vendors_name_unique unique (tenant_id, name)
);

-- ---------------------------------------------------------------------------
-- clients — the END client. Where the employee actually sits.
--
-- Never invoiced by us (the vendor is), so it has no payment terms. It exists
-- so "who is this person working for" has one answer with one spelling.
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 160),
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  email        text check (email is null or length(email) <= 200),
  address      jsonb not null default '{}'::jsonb,
  notes        text,
  status       public.party_status not null default 'active',
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint clients_name_unique unique (tenant_id, name)
);

-- 018's composite-key pattern: a child row must be structurally unable to point
-- at another tenant's parent. Redundant on its own (id is already unique) and
-- load-bearing as a foreign-key target.
do $$ begin
  alter table public.vendors add constraint vendors_id_tenant_uq unique (id, tenant_id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.clients add constraint clients_id_tenant_uq unique (id, tenant_id);
exception when duplicate_object then null; end $$;

-- `profiles` was not in 018's list of parents because nothing pointed at it
-- tenant-safely yet. Something does now. Nullable `tenant_id` (a super admin
-- has none) is no obstacle to the unique constraint.
do $$ begin
  alter table public.profiles add constraint profiles_id_tenant_uq unique (id, tenant_id);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- employee_assignments — one employee, at one client, through one vendor,
-- at two rates.
--
-- `is_primary` is what a new timesheet defaults to. A person on two assignments
-- picks; a person on one never has to.
-- ---------------------------------------------------------------------------
create table if not exists public.employee_assignments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  employee_id   uuid not null,
  vendor_id     uuid not null,
  client_id     uuid,
  project_id    uuid,

  -- THE TWO RATES. See the header before touching either.
  bill_rate     numeric(12,2) check (bill_rate is null or bill_rate >= 0),
  bill_currency text not null default 'USD' check (bill_currency ~ '^[A-Z]{3}$'),
  pay_rate      numeric(12,2) check (pay_rate is null or pay_rate >= 0),
  pay_currency  text not null default 'USD' check (pay_currency ~ '^[A-Z]{3}$'),
  rate_unit     public.rate_unit not null default 'hour',

  start_date    date,
  end_date      date,
  is_primary    boolean not null default false,
  status        public.assignment_status not null default 'active',
  notes         text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint employee_assignments_range_ck
    check (end_date is null or start_date is null or end_date >= start_date),
  -- Tenant-safe parents (018).
  constraint employee_assignments_employee_fk
    foreign key (employee_id, tenant_id) references public.profiles (id, tenant_id) on delete cascade,
  constraint employee_assignments_vendor_fk
    foreign key (vendor_id, tenant_id) references public.vendors (id, tenant_id) on delete restrict,
  constraint employee_assignments_client_fk
    foreign key (client_id, tenant_id) references public.clients (id, tenant_id) on delete set null,
  constraint employee_assignments_project_fk
    foreign key (project_id, tenant_id) references public.projects (id, tenant_id) on delete set null
);

do $$ begin
  alter table public.employee_assignments
    add constraint employee_assignments_id_tenant_uq unique (id, tenant_id);
exception when duplicate_object then null; end $$;

-- At most ONE primary per employee. Partial, so ended assignments and
-- non-primary ones do not contend for it.
create unique index if not exists employee_assignments_primary_uq
  on public.employee_assignments (tenant_id, employee_id)
  where is_primary and status = 'active';

create index if not exists employee_assignments_employee_idx
  on public.employee_assignments (tenant_id, employee_id, status);
create index if not exists employee_assignments_vendor_idx
  on public.employee_assignments (tenant_id, vendor_id);

create index if not exists vendors_tenant_idx on public.vendors (tenant_id, status, name);
create index if not exists clients_tenant_idx on public.clients (tenant_id, status, name);

drop trigger if exists set_updated_at on public.vendors;
create trigger set_updated_at before update on public.vendors
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.clients;
create trigger set_updated_at before update on public.clients
  for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at on public.employee_assignments;
create trigger set_updated_at before update on public.employee_assignments
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--
-- All three are ORG-ONLY, INCLUDING SELECT. That is the point for
-- `employee_assignments` (see the header); for vendors and clients it is merely
-- correct — an employee has no reason to enumerate the org's commercial
-- relationships, and the names they DO need reach them through the view below.
-- ---------------------------------------------------------------------------
alter table public.vendors              enable row level security;
alter table public.clients              enable row level security;
alter table public.employee_assignments enable row level security;

alter table public.vendors              force row level security;
alter table public.clients              force row level security;
alter table public.employee_assignments force row level security;

drop policy if exists vendors_all on public.vendors;
create policy vendors_all on public.vendors for all to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
)
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

drop policy if exists clients_all on public.clients;
create policy clients_all on public.clients for all to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
)
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

drop policy if exists employee_assignments_all on public.employee_assignments;
create policy employee_assignments_all on public.employee_assignments for all to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
)
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

-- ---------------------------------------------------------------------------
-- my_assignments — the employee's own view of their placement.
--
-- READ THE HEADER BEFORE CHANGING THIS VIEW. Three properties make it safe, and
-- all three are load-bearing:
--
--   • It does not select `bill_rate`. Not filtered out, not masked — absent.
--     There is no query against this view that produces it.
--   • `where a.employee_id = auth.uid()` is the only reason it may bypass the
--     org-only policy on the base table. Remove it and every employee sees
--     every colleague's pay.
--   • `security_barrier` stops a caller's own WHERE clause (or a leaky function
--     in one) from being pushed below that filter to sniff other rows.
--
-- Deliberately NOT `security_invoker = true`: as its owner it can see past the
-- base table's org-only policy, which is precisely what lets an employee learn
-- their own vendor, client and pay rate without being able to read the table.
-- ---------------------------------------------------------------------------
drop view if exists public.my_assignments;
create view public.my_assignments
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
  a.status
from public.employee_assignments a
left join public.vendors v on v.id = a.vendor_id and v.tenant_id = a.tenant_id
left join public.clients c on c.id = a.client_id and c.tenant_id = a.tenant_id
where a.employee_id = (select auth.uid());

revoke all on public.my_assignments from anon, public;
grant select on public.my_assignments to authenticated;

comment on view public.my_assignments is
  'An employee''s own placement, WITHOUT bill_rate. See 022 — the absence of '
  'that column is a security control, not an oversight.';
