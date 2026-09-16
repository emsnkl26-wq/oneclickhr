-- ============================================================================
-- 034_current_profile_v4.sql — the workspace currency joins the per-request
-- context.
--
-- `current_profile()` is resolved once per request by src/lib/auth/context.ts
-- and is what every guard, layout and nav decision reads. `default_currency`
-- (033) has to be in it: every money figure the expenses page and the dashboard
-- render is denominated in it, and fetching it separately would be a second
-- round trip on a page that already has one.
--
-- 029's version, plus that one column. The `domain_token` exclusion 013 argued
-- for still stands — this context is carried by every render, so nothing secret
-- goes in it. A currency code is not.
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
  tenant_default_tracking_mode text,
  tenant_default_currency text
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
         t.default_currency
    from public.profiles p
    left join public.tenants t on t.id = p.tenant_id
   where p.id = auth.uid();
$$;

revoke execute on function public.current_profile() from anon, public;
grant execute on function public.current_profile() to authenticated, service_role;
