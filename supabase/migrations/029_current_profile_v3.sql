-- ============================================================================
-- 029_current_profile_v3.sql — three new facts in the per-request context.
--
-- `current_profile()` is resolved once per request by src/lib/auth/context.ts
-- and is what every guard, every layout and every nav decision reads. Three
-- things added by 025 and 027 have to be there, because deciding them anywhere
-- else means a second round trip on every page render:
--
--   tracking_mode          — whether this person clocks in, files a timesheet,
--                            or neither. Drives the sidebar and two API guards.
--   is_owner               — owner versus invited admin. Drives `requireOwner()`.
--   tenant_default_tracking_mode — what a NEW employee inherits. Read by the
--                            settings screen and the create-employee form.
--
-- 013's version, plus those three. The `domain_token` exclusion noted there
-- still stands: this context is carried by every render, so nothing secret goes
-- in it. A tracking mode and an ownership flag are neither.
--
-- `drop function` first because the RETURNS TABLE signature changes, and
-- `create or replace` cannot alter a function's result type.
--
-- Re-runnable.
-- ============================================================================

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
  tenant_default_tracking_mode text
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
         t.default_tracking_mode::text
    from public.profiles p
    left join public.tenants t on t.id = p.tenant_id
   where p.id = auth.uid();
$$;

revoke execute on function public.current_profile() from anon, public;
grant execute on function public.current_profile() to authenticated, service_role;

-- 013 revoked blanket SELECT on `tenants` and re-granted it column by column,
-- so a column added afterwards is invisible to a session until it is named here.
grant select (default_tracking_mode) on public.tenants to authenticated;
