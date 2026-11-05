-- ============================================================================
-- 064_org_two_factor.sql — authenticator-app (TOTP) two-step verification for
-- organization administrators.
--
-- WHAT
--
--   public.user_two_factor   One row per org user who has set up (or started
--                            setting up) an authenticator. Holds the TOTP shared
--                            secret, ENCRYPTED at rest by the application
--                            (src/lib/crypto.ts, AES-256-GCM) exactly like the
--                            Google refresh token — the database never sees the
--                            plaintext secret, so a row leak is not a bypass.
--
--                            `enabled` is false while enrolling (a pending secret
--                            that has not yet been proven with a code) and true
--                            once the first code has verified. The gate only ever
--                            enforces an ENABLED row.
--
--   tenants.two_factor_window_hours
--                            How long a passed check is honoured before the admin
--                            is asked again. Org-level (one setting for the
--                            workspace), default 8 hours, bounded 1..720.
--
-- WHO IT COVERS: organization-portal users only (owner + invited admins). The
-- application gate (src/lib/auth/guards.ts) scopes enforcement to role = 'org';
-- employees and job seekers are untouched. Enrolment is PER ADMIN — each person
-- has their own secret and their own row — so losing one phone never exposes
-- another admin.
--
-- RLS: a row is private to the person it belongs to. Every policy is
-- `profile_id = auth.uid()`, so one admin can never read, change or delete
-- another's secret, and an org admin has no window into anyone else's at all.
-- The server reads and writes these rows on the caller's own session, so that
-- one rule is the whole access model — no service-role path is involved.
--
-- Re-runnable.
-- ============================================================================

create table if not exists public.user_two_factor (
  profile_id       uuid primary key references public.profiles(id) on delete cascade,
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  -- AES-256-GCM ciphertext (v1:iv:tag:ct), never the raw base32 secret.
  secret_enc       text not null,
  -- False while enrolling; true once a code has proven the secret.
  enabled          boolean not null default false,
  enrolled_at      timestamptz,
  last_verified_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists user_two_factor_tenant_idx
  on public.user_two_factor (tenant_id);

drop trigger if exists set_updated_at on public.user_two_factor;
create trigger set_updated_at before update on public.user_two_factor
  for each row execute function public.tg_set_updated_at();

alter table public.user_two_factor enable  row level security;
alter table public.user_two_factor force   row level security;

-- A row belongs to exactly one person, and only that person touches it.
drop policy if exists user_two_factor_select on public.user_two_factor;
create policy user_two_factor_select on public.user_two_factor for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists user_two_factor_insert on public.user_two_factor;
create policy user_two_factor_insert on public.user_two_factor for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and tenant_id = (select app.current_tenant_id())
  );

drop policy if exists user_two_factor_update on public.user_two_factor;
create policy user_two_factor_update on public.user_two_factor for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists user_two_factor_delete on public.user_two_factor;
create policy user_two_factor_delete on public.user_two_factor for delete to authenticated
  using (profile_id = (select auth.uid()));

grant select, insert, update, delete on public.user_two_factor to authenticated;

-- --- The org-level re-prompt window -----------------------------------------
-- `tenants` had its blanket grants revoked in 013 and re-granted column by
-- column, so a new column is granted explicitly or the settings save fails
-- 42501 (see 042, 049, 056).
alter table public.tenants
  add column if not exists two_factor_window_hours integer not null default 8
    check (two_factor_window_hours between 1 and 720);

grant select (two_factor_window_hours) on public.tenants to authenticated;
grant update (two_factor_window_hours) on public.tenants to authenticated;

-- ----------------------------------------------------------------------------
-- `current_profile()` — 060's version, plus `two_factor_enabled`.
--
-- The per-request gate (src/lib/auth/guards.ts) needs to know whether this user
-- has 2FA switched on. Folding it into the one profile round trip every page
-- already makes keeps the gate free of an extra query — the same move 060 made
-- for the session check. Appended LAST so the shape stays additive; existing
-- consumers read by name and are unaffected.
--
-- `drop` first because the RETURNS TABLE signature changes (see 060's note). The
-- pair is atomic inside the migration transaction.
-- ----------------------------------------------------------------------------
drop function if exists public.current_profile();

create or replace function public.current_profile()
returns table (
  id uuid,
  tenant_id uuid,
  role text,
  full_name text,
  email text,
  photo_url text,
  is_active boolean,
  must_change_password boolean,
  department_id uuid,
  tracking_mode text,
  is_owner boolean,
  tenant_name text,
  tenant_slug text,
  tenant_status text,
  tenant_logo_url text,
  tenant_primary_color text,
  tenant_timezone text,
  tenant_work_start_time text,
  tenant_onboarded boolean,
  tenant_domain text,
  tenant_domain_verified boolean,
  tenant_domain_due_at timestamptz,
  tenant_default_tracking_mode text,
  tenant_default_currency text,
  session_active boolean,
  two_factor_enabled boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select p.id, p.tenant_id, p.role::text, p.full_name, p.email::text, p.photo_url,
         p.is_active, p.must_change_password, p.department_id,
         p.tracking_mode::text, p.is_owner,
         t.name, t.slug, t.status::text, t.logo_url, t.primary_color, t.timezone,
         to_char(t.work_start_time, 'HH24:MI'),
         (t.onboarded_at is not null),
         t.domain,
         (t.domain_verified_at is not null),
         t.domain_verify_due_at,
         t.default_tracking_mode::text,
         t.default_currency,
         public.auth_session_active(),
         exists (
           select 1 from public.user_two_factor f
            where f.profile_id = p.id and f.enabled
         )
    from public.profiles p
    left join public.tenants t on t.id = p.tenant_id
   where p.id = auth.uid();
$$;

revoke execute on function public.current_profile() from anon, public;
grant execute on function public.current_profile() to authenticated, service_role;
