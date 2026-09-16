-- ============================================================================
-- 035_push_notifications.sql — every notification also reaches the device.
--
-- WHAT THIS ADDS
--
--   push_subscriptions      One row per BROWSER that has granted permission.
--                           Not per user: a person with a laptop, a phone and a
--                           second profile on the same laptop is three rows, and
--                           all three are legitimate delivery targets.
--
--   notifications.importance
--                           Whether this one is worth an email as well as a
--                           push. Written by the server from a fixed catalog
--                           (src/lib/notifications/events.ts), never by a
--                           client.
--
--   notification_deliveries A ledger of what was actually sent, keyed so that a
--                           second attempt CANNOT duplicate it.
--
-- THE LEDGER IS THE WHOLE RELIABILITY STORY, so it is worth saying plainly why
-- it is shaped the way it is.
--
-- A route handler that has just approved a timesheet may be retried — by the
-- platform, by a user double-clicking, by a client that timed out and resent.
-- "Have we emailed this person yet?" answered with a SELECT and then an INSERT
-- is a race that two concurrent runs both pass, and the employee gets the same
-- email twice. So delivery CLAIMS first: it inserts
-- (notification_id, user_id, channel) and only sends if the insert won. The
-- primary key is the concurrency control, exactly as `visa_reminder_logs` is in
-- 004 — a check that cannot be raced because the database performs it.
--
-- The claim is also why `status` exists rather than the row simply being
-- present: a claim that is written and then fails to send is recorded as
-- 'failed' with its reason, which is the difference between an operator seeing
-- "we never tried" and "we tried and the push service refused us".
--
-- ENDPOINT IS THE IDENTITY OF A SUBSCRIPTION, not (user, device). The browser
-- mints a fresh endpoint whenever the subscription is renewed or the service
-- worker is replaced, and the same endpoint can be handed back to a DIFFERENT
-- user if two people share a browser profile and one signs out. Making the
-- endpoint globally unique and UPSERTING on it means the second person's
-- subscription takes the row over rather than sitting alongside it — which is
-- what stops a signed-out colleague's laptop from buzzing with someone else's
-- payroll.
--
-- KEYS ARE NOT SECRETS TO THE SERVER BUT THEY ARE SECRETS TO EVERYONE ELSE.
-- `p256dh` and `auth` are what encrypt the payload for that one browser. Anyone
-- holding them plus the endpoint can push arbitrary content to that device, so
-- RLS here is deliberately tighter than anywhere else in this schema: a person
-- can see and delete THEIR OWN rows and nothing more. Not their department's,
-- not their tenant's — and an org admin gets no read either, because an
-- administrator has no reason to hold the key that talks to an employee's phone.
-- The server reads them with the service role, scoped by tenant, in
-- src/lib/push/send.ts.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- push_subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,

  -- The push service URL the browser gave us. Globally unique: see the header.
  endpoint     text not null unique check (length(endpoint) between 20 and 2000),

  -- RFC 8291 client keys, base64url, exactly as PushSubscription.toJSON()
  -- reports them. Lengths are checked so a malformed pair is refused at write
  -- time rather than throwing inside the encrypter on every later send.
  p256dh       text not null check (length(p256dh) between 80 and 200),
  auth         text not null check (length(auth) between 16 and 40),

  -- Diagnostics only. Truncated by the server; never trusted, never parsed.
  user_agent   text check (user_agent is null or length(user_agent) <= 400),

  created_at   timestamptz not null default now(),
  -- Touched every time the browser re-announces this subscription, which it
  -- does on each page load. A row that has not been seen for months belongs to
  -- a browser that is gone, and the sweep below collects it.
  last_seen_at timestamptz not null default now(),

  -- Consecutive send failures that were NOT fatal (a timeout, a 500 from the
  -- push service). A fatal refusal (404/410 — the subscription is gone) deletes
  -- the row outright instead of counting.
  failure_count int not null default 0 check (failure_count >= 0)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);
create index if not exists push_subscriptions_tenant_idx
  on public.push_subscriptions (tenant_id, user_id);
create index if not exists push_subscriptions_stale_idx
  on public.push_subscriptions (last_seen_at);

comment on table public.push_subscriptions is
  'One row per browser that has granted notification permission. Keys are secrets: RLS is self-only.';

-- ---------------------------------------------------------------------------
-- notifications.importance — does this one also deserve an email?
-- ---------------------------------------------------------------------------
do $mig$
begin
  create type public.notification_importance as enum ('normal', 'important');
exception
  when duplicate_object then null;
end
$mig$;

alter table public.notifications
  add column if not exists importance public.notification_importance not null default 'normal';

comment on column public.notifications.importance is
  'normal = in-app + web push. important = those plus an email. Set by the server from a fixed catalog.';

-- ---------------------------------------------------------------------------
-- notification_deliveries — the claim ledger
-- ---------------------------------------------------------------------------
do $mig$
begin
  create type public.notification_channel as enum ('push', 'email');
exception
  when duplicate_object then null;
end
$mig$;

do $mig$
begin
  create type public.notification_delivery_status as enum ('sent', 'failed', 'skipped');
exception
  when duplicate_object then null;
end
$mig$;

create table if not exists public.notification_deliveries (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  channel         public.notification_channel not null,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  status          public.notification_delivery_status not null default 'sent',
  -- A short reason when status <> 'sent'. Operator-facing, never shown to a user.
  detail          text check (detail is null or length(detail) <= 500),
  created_at      timestamptz not null default now(),

  -- THE CONCURRENCY CONTROL. One delivery per person per channel per
  -- notification, enforced by Postgres rather than by a racy check-then-send.
  primary key (notification_id, user_id, channel)
);

create index if not exists notification_deliveries_tenant_idx
  on public.notification_deliveries (tenant_id, created_at desc);

comment on table public.notification_deliveries is
  'Claim-then-send ledger. The primary key is what makes a retry safe: the second attempt loses the insert and sends nothing.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.push_subscriptions      enable row level security;
alter table public.notification_deliveries enable row level security;

-- A person manages their own browsers. Nobody else reads these keys through the
-- API — not an org admin, not a super admin. The server uses the service role.
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
with check (
  user_id = auth.uid()
  and tenant_id = app.current_tenant_id()
  and app.is_active_member()
);

drop policy if exists push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid() and tenant_id = app.current_tenant_id());

drop policy if exists push_subscriptions_delete on public.push_subscriptions;
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
using (user_id = auth.uid());

-- The ledger is operational data. An org user may read their own workspace's
-- rows to answer "did that reminder actually go out?"; nobody writes it through
-- the API at all, because every write is a CLAIM the server makes with the
-- service role and a client-written claim would suppress a real delivery.
drop policy if exists notification_deliveries_select on public.notification_deliveries;
create policy notification_deliveries_select on public.notification_deliveries for select to authenticated
using (
  app.is_super_admin()
  or user_id = auth.uid()
  or (tenant_id = app.current_tenant_id() and app.is_org())
);

-- ---------------------------------------------------------------------------
-- Housekeeping
--
-- Both of these are pure garbage collection, called from /api/cron/push-gc.
--
-- IN `public`, NOT `app`, and the distinction is load-bearing rather than
-- stylistic. The `app` schema holds the helpers that RLS policies call from
-- INSIDE Postgres (`app.is_org()`, `app.current_tenant_id()`); PostgREST does
-- not expose it, so a function placed there cannot be reached by `.rpc()` at
-- all — the call fails at runtime with a "function not found" that looks like a
-- missing migration. Everything the application invokes over the API lives in
-- `public`, as `rate_limit_hit` and `generate_due_expenses` already do.
--
-- SECURITY DEFINER so the cron's service-role call is the only thing that can
-- reach them, and `authenticated` is granted nothing. `search_path` is pinned so
-- a caller cannot shadow `public` with a schema of their own and have the
-- definer's privileges execute it.
-- ---------------------------------------------------------------------------
create or replace function public.prune_push_subscriptions(p_stale_days int default 120)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  removed int;
begin
  -- Two kinds of dead row: one whose browser has not checked in for months, and
  -- one that has failed to deliver repeatedly without ever returning the 410
  -- that would have deleted it outright.
  delete from public.push_subscriptions
  where last_seen_at < now() - make_interval(days => greatest(p_stale_days, 7))
     or failure_count >= 10;
  get diagnostics removed = row_count;
  return removed;
end
$fn$;

create or replace function public.prune_notification_deliveries(p_keep_days int default 90)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  removed int;
begin
  -- The ledger exists to make a RETRY safe and a failure explainable. Neither
  -- purpose survives the notification itself by more than a quarter.
  delete from public.notification_deliveries
  where created_at < now() - make_interval(days => greatest(p_keep_days, 7));
  get diagnostics removed = row_count;
  return removed;
end
$fn$;

revoke execute on function public.prune_push_subscriptions(int) from anon, authenticated, public;
revoke execute on function public.prune_notification_deliveries(int) from anon, authenticated, public;
grant execute on function public.prune_push_subscriptions(int) to service_role;
grant execute on function public.prune_notification_deliveries(int) to service_role;
