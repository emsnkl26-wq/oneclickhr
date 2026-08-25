-- ============================================================================
-- 011_helpdesk.sql — internal ticketing between an employee and their org.
--
-- Shape: a ticket carries the request; every message after it — from either
-- side — is a row in `ticket_messages`. The employee's original description
-- lives on the ticket itself so the thread's first paragraph cannot be edited
-- away from under a reply that answers it.
--
-- Same conventions as 010: `(select app.is_org())` so the helper folds into an
-- InitPlan, row-dependent helpers left unwrapped.
-- ============================================================================

do $$ begin
  create type public.ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ticket_priority as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- tickets
-- ---------------------------------------------------------------------------
create table if not exists public.tickets (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  employee_id      uuid not null references public.profiles(id) on delete cascade,
  code             text not null,
  subject          text not null check (length(btrim(subject)) between 1 and 200),
  description      text not null check (length(btrim(description)) between 1 and 8000),
  priority         public.ticket_priority not null default 'medium',
  status           public.ticket_status not null default 'open',
  attachment_url   text,
  attachment_name  text,
  -- Bumped by every reply and status change, so "recently active" is an index
  -- scan rather than a join against the message table.
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint tickets_code_unique unique (tenant_id, code)
);

drop trigger if exists set_updated_at on public.tickets;
create trigger set_updated_at before update on public.tickets
  for each row execute function public.tg_set_updated_at();

create index if not exists tickets_tenant_idx        on public.tickets (tenant_id, last_activity_at desc);
create index if not exists tickets_tenant_status_idx on public.tickets (tenant_id, status);
create index if not exists tickets_employee_idx      on public.tickets (employee_id, created_at desc);

create or replace function public.tg_tickets_code()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.code is null or btrim(new.code) = '' then
    new.code := public.format_tenant_code(
      'TKT', public.next_tenant_sequence(new.tenant_id, 'ticket'), 3
    );
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_code on public.tickets;
create trigger tickets_code before insert on public.tickets
  for each row execute function public.tg_tickets_code();

-- ---------------------------------------------------------------------------
-- ticket_messages — the conversation, oldest first.
-- ---------------------------------------------------------------------------
create table if not exists public.ticket_messages (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  ticket_id       uuid not null references public.tickets(id) on delete cascade,
  author_id       uuid references public.profiles(id) on delete set null,
  -- Denormalised so the thread still reads correctly after an account is
  -- deactivated and the profile join comes back empty.
  author_role     public.user_role not null default 'employee',
  body            text not null check (length(btrim(body)) between 1 and 8000),
  attachment_url  text,
  attachment_name text,
  created_at      timestamptz not null default now()
);

create index if not exists ticket_messages_ticket_idx on public.ticket_messages (ticket_id, created_at);
create index if not exists ticket_messages_tenant_idx on public.ticket_messages (tenant_id);

/** Every reply bumps the ticket, so the queue sorts by real activity. */
create or replace function public.tg_ticket_messages_touch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.tickets
     set last_activity_at = now()
   where id = new.ticket_id;
  return null;
end;
$$;

drop trigger if exists ticket_messages_touch on public.ticket_messages;
create trigger ticket_messages_touch after insert on public.ticket_messages
  for each row execute function public.tg_ticket_messages_touch();

-- ---------------------------------------------------------------------------
-- app helper
-- ---------------------------------------------------------------------------
create or replace function app.owns_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.tickets t
     where t.id = p_ticket_id and t.employee_id = auth.uid()
  );
$$;

/** A closed thread takes no more replies from either side. */
create or replace function app.ticket_is_open(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.tickets t
     where t.id = p_ticket_id and t.status <> 'closed'
  );
$$;

revoke all on all functions in schema app from anon, public;
grant execute on all functions in schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tickets         enable row level security;
alter table public.ticket_messages enable row level security;

drop policy if exists tickets_select on public.tickets;
create policy tickets_select on public.tickets for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or employee_id = (select auth.uid()))
  )
);

-- An employee raises their own ticket, and it always starts `open`. The org may
-- also file one on someone's behalf.
drop policy if exists tickets_insert on public.tickets;
create policy tickets_insert on public.tickets for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    (select app.is_org())
    or (employee_id = (select auth.uid()) and status = 'open')
  )
);

-- Only the org moves a ticket through its states. An employee who could UPDATE
-- their own row could close a ticket the org is still working, or reopen one it
-- had resolved — so they reply instead, and the reply is what reopens nothing.
drop policy if exists tickets_update on public.tickets;
create policy tickets_update on public.tickets for update to authenticated
using  (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

drop policy if exists tickets_delete on public.tickets;
create policy tickets_delete on public.tickets for delete to authenticated
using (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

drop policy if exists ticket_messages_select on public.ticket_messages;
create policy ticket_messages_select on public.ticket_messages for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or app.owns_ticket(ticket_id))
  )
);

drop policy if exists ticket_messages_insert on public.ticket_messages;
create policy ticket_messages_insert on public.ticket_messages for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and author_id = (select auth.uid())
  and app.ticket_is_open(ticket_id)
  and ((select app.is_org()) or app.owns_ticket(ticket_id))
);

-- No UPDATE policy: a thread is a record of what was said. Corrections are a
-- new message, which is also what the person on the other side gets notified of.
drop policy if exists ticket_messages_delete on public.ticket_messages;
create policy ticket_messages_delete on public.ticket_messages for delete to authenticated
using (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

analyze public.tickets;
analyze public.ticket_messages;
