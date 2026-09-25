-- ============================================================================
-- 053_super_admin_talent_and_purge.sql — two platform-console capabilities.
--
-- 1. super_talent_directory — every employee on the platform with their work
--    authorization, in one row each, so the platform team can find people to
--    hire. A VIEW readable by the SERVICE ROLE ONLY: it joins across every
--    tenant, which no end-user session may ever do, and the super-admin pages
--    read it through the admin client behind requireSuperAdmin() like every
--    other cross-tenant page in /super.
--
--    Work authorization comes from two places and both are shown:
--      • the latest `work_authorizations` row — the visa the org tracks, with
--        its expiry (what the reminder engine runs on);
--      • the status the employee gave at onboarding (`employee_onboarding`),
--        for people whose visa is not tracked, e.g. citizens / green card.
--    The visa NUMBER is deliberately not in the view.
--
-- 2. purge_tenant(uuid) — the last step of deleting an organization.
--    Deleting the `tenants` row cascades to every tenant-scoped table. The one
--    thing that stops it is `employee_assignments_vendor_fk ON DELETE RESTRICT`
--    (022), which Postgres checks row by row mid-cascade — so placements go
--    first, explicitly, in the same transaction. Profiles are removed by the
--    application beforehand by deleting their AUTH users (profiles cascade from
--    auth.users), which is what stops a login outliving its workspace.
--    EXECUTE is granted to the service role only.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The talent directory.
-- ---------------------------------------------------------------------------
drop view if exists public.super_talent_directory;
create view public.super_talent_directory
with (security_invoker = true)
as
select
  p.id,
  p.tenant_id,
  t.name                          as tenant_name,
  t.status::text                  as tenant_status,
  p.full_name,
  p.email::text                   as email,
  p.phone,
  p.designation,
  p.employee_code,
  p.is_active,
  p.date_of_joining,
  p.city,
  p.state_province,
  p.country,
  p.employment_type,
  p.skills,
  p.photo_url,
  p.created_at,
  ob.work_auth_status             as onboarding_work_auth_status,
  ob.visa_type                    as onboarding_visa_type,
  wa.visa_type,
  wa.start_date                   as visa_start_date,
  wa.expiry_date                  as visa_expiry_date,
  case
    when wa.expiry_date is null then null
    else (wa.expiry_date - current_date)
  end                             as visa_days_left,
  case
    when wa.expiry_date is null then
      case when ob.work_auth_status is null then 'unknown' else 'not_tracked' end
    when wa.expiry_date < current_date then 'expired'
    when wa.expiry_date <= current_date + 90 then 'expiring'
    else 'valid'
  end                             as visa_state,
  xp.role_title                   as latest_role_title,
  xp.company_name                 as latest_company
from public.profiles p
join public.tenants t on t.id = p.tenant_id
left join lateral (
  select w.visa_type, w.start_date, w.expiry_date
    from public.work_authorizations w
   where w.employee_id = p.id
   order by w.expiry_date desc
   limit 1
) wa on true
left join lateral (
  select o.work_auth_status, o.visa_type
    from public.employee_onboarding o
   where o.employee_profile_id = p.id
   order by o.updated_at desc
   limit 1
) ob on true
left join lateral (
  select e.role_title, e.company_name
    from public.employee_experience e
   where e.employee_id = p.id
   order by e.is_current desc, e.start_date desc nulls last
   limit 1
) xp on true
where p.role = 'employee';

-- Service role only. `security_invoker` means that even if a grant slipped
-- back, an ordinary session would see only what RLS already lets it see.
revoke all on public.super_talent_directory from anon, authenticated, public;
grant select on public.super_talent_directory to service_role;

comment on view public.super_talent_directory is
  'Every employee with their work authorization, for the platform console (053). Service role only.';

-- ---------------------------------------------------------------------------
-- 2. Purging an organization.
-- ---------------------------------------------------------------------------
create or replace function public.purge_tenant(p_tenant uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if p_tenant is null then
    raise exception 'A tenant id is required';
  end if;

  -- The only RESTRICT in the cascade path (see the header).
  delete from public.employee_assignments where tenant_id = p_tenant;

  -- Everything else is ON DELETE CASCADE from tenants (or SET NULL for the
  -- audit trail and support requests, which outlive the workspace on purpose).
  delete from public.tenants where id = p_tenant;

  if not found then
    raise exception 'That organization was not found';
  end if;
end;
$fn$;

revoke execute on function public.purge_tenant(uuid) from anon, authenticated, public;
grant execute on function public.purge_tenant(uuid) to service_role;

notify pgrst, 'reload schema';
