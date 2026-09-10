-- ============================================================================
-- 028_support_requests.sql — a way to tell US something.
--
-- NOT THE HELP DESK. `tickets` (011) is a workspace's own queue: an employee
-- asks their HR team for a payslip correction, and their HR team answers. It
-- never leaves the tenant, and it should not — an org's internal tickets are
-- none of the platform's business.
--
-- This is the other direction, and it had no channel at all: a user of the
-- product telling Oneclickhr that something is broken, that they want a
-- feature, or that they have a billing question. Those arrived by whatever
-- email address somebody happened to know.
--
-- ASYMMETRIC BY DESIGN:
--
--   insert  — any signed-in member of any workspace, for their own tenant.
--   select  — SUPER ADMIN ONLY.
--   update  — SUPER ADMIN ONLY.
--
-- A user cannot read back even their own submissions. That is on purpose: this
-- table will hold "your competitor's org is doing X" and support notes about
-- other customers, and the moment it is readable by a tenant it becomes a
-- disclosure surface. The product answers by EMAIL, which is where the person
-- expects an answer anyway.
--
-- Re-runnable.
-- ============================================================================

do $$ begin
  create type public.support_category as enum
    ('bug', 'feature', 'billing', 'account', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_status as enum ('new', 'in_progress', 'resolved');
exception when duplicate_object then null; end $$;

create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  -- Nullable: a super admin has no tenant, and they can file one too.
  tenant_id   uuid references public.tenants(id) on delete set null,
  profile_id  uuid references public.profiles(id) on delete set null,

  -- Copied at submit time rather than joined on read. The whole point of a
  -- support record is that it survives the account being deleted — an
  -- unattributable bug report is nearly useless.
  reporter_name  text check (reporter_name is null or length(reporter_name) <= 160),
  reporter_email text check (reporter_email is null or length(reporter_email) <= 200),
  tenant_name    text check (tenant_name is null or length(tenant_name) <= 160),

  category    public.support_category not null default 'other',
  subject     text not null check (length(btrim(subject)) between 1 and 200),
  message     text not null check (length(btrim(message)) between 1 and 5000),

  -- Where they were when they hit it. Saves the first round trip of every
  -- support conversation ever had.
  page_url    text check (page_url is null or length(page_url) <= 500),
  user_agent  text check (user_agent is null or length(user_agent) <= 500),

  status      public.support_status not null default 'new',
  assigned_to uuid references public.profiles(id) on delete set null,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 5000),
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists support_requests_queue_idx
  on public.support_requests (status, created_at desc);
create index if not exists support_requests_tenant_idx
  on public.support_requests (tenant_id, created_at desc);

drop trigger if exists set_updated_at on public.support_requests;
create trigger set_updated_at before update on public.support_requests
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.support_requests enable row level security;
alter table public.support_requests force row level security;

-- Anyone signed in may report something — about their OWN workspace, as
-- THEMSELVES. Both are pinned to the session so a request cannot be filed in
-- somebody else's name.
drop policy if exists support_requests_insert on public.support_requests;
create policy support_requests_insert on public.support_requests
for insert to authenticated
with check (
  (select app.is_active_member())
  and profile_id = (select auth.uid())
  and (tenant_id is null or tenant_id = (select app.current_tenant_id()))
);

-- Reading is the platform's alone. See the header.
drop policy if exists support_requests_select on public.support_requests;
create policy support_requests_select on public.support_requests
for select to authenticated
using ((select app.is_super_admin()));

drop policy if exists support_requests_update on public.support_requests;
create policy support_requests_update on public.support_requests
for update to authenticated
using ((select app.is_super_admin()))
with check ((select app.is_super_admin()));

-- No delete policy, deliberately: a support queue nobody can quietly empty is
-- worth more than a tidy one.
