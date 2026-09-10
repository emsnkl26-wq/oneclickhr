-- ============================================================================
-- 027_org_admins.sql — more than one person may run a workspace.
--
-- Until now `role = 'org'` was set in exactly one place: `provision_tenant_for_org()`
-- at self-signup. Every org-side "create a user" path stamps `app_role: 'employee'`.
-- So a workspace had precisely one administrator, forever, and an organization
-- whose founder was on holiday could not approve a timesheet.
--
-- WHAT THIS ADDS is one boolean, and the restraint is deliberate.
--
--     is_owner = true   the person who created the workspace.
--     is_owner = false  an admin they invited. Same access to /org, all of it.
--
-- There is no permission matrix. An admin can do everything an owner can except
-- the three things that would let them take the workspace away from the person
-- who made it: invite another admin, revoke one, and change the domain. Those
-- are owner-only, checked by `requireOwner()` in the application.
--
-- WHY OWNERSHIP IS A COLUMN AND NOT A NEW ROLE. `user_role` is mirrored into
-- the JWT by the access-token hook (003) and read by every RLS policy in 002.
-- Adding a fourth enum value would mean revisiting every one of those policies
-- to decide whether it counts as `is_org()`, and the answer would be "yes" every
-- single time. A boolean beside the role changes no policy and no claim.
--
-- Re-runnable.
-- ============================================================================

alter table public.profiles
  add column if not exists is_owner boolean not null default false;

-- ---------------------------------------------------------------------------
-- Backfill: the earliest org-role profile in each tenant is its owner.
--
-- `created_at` then `id` so the choice is deterministic on the vanishingly
-- unlikely tie. Only runs where a tenant has no owner yet, so a second run
-- cannot move ownership.
-- ---------------------------------------------------------------------------
with first_org as (
  select distinct on (tenant_id) id, tenant_id
    from public.profiles
   where role = 'org' and tenant_id is not null
   order by tenant_id, created_at asc, id asc
)
update public.profiles p
   set is_owner = true
  from first_org f
 where p.id = f.id
   and not exists (
     select 1 from public.profiles o
      where o.tenant_id = f.tenant_id and o.is_owner
   );

-- One owner per workspace. Partial, so the hundreds of employees with
-- `is_owner = false` do not contend.
create unique index if not exists profiles_owner_uq
  on public.profiles (tenant_id)
  where is_owner;

-- ---------------------------------------------------------------------------
-- Nobody may make themselves an owner.
--
-- 025 rewrote this guard to add `tracking_mode`; this adds `is_owner` to both
-- branches. An ORG user may not set it either — otherwise an invited admin
-- promotes themselves and locks the founder out, which is the exact failure
-- the owner/admin split exists to prevent. Ownership moves only through the
-- service role, from a route that checks the caller is the current owner.
-- ---------------------------------------------------------------------------
create or replace function public.tg_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable';
  end if;

  -- Ownership is server-owned on EVERY client path, org included.
  if new.is_owner is distinct from old.is_owner then
    raise exception 'Workspace ownership is managed by the server';
  end if;

  if app.is_org() and old.tenant_id = app.current_tenant_id() then
    if new.role is distinct from old.role then
      raise exception 'role changes are not permitted from the client';
    end if;
    return new;
  end if;

  if auth.uid() = old.id then
    if new.role          is distinct from old.role
       or new.is_active  is distinct from old.is_active
       or new.employee_code is distinct from old.employee_code
       or new.designation   is distinct from old.designation
       or new.department_id is distinct from old.department_id
       or new.date_of_joining is distinct from old.date_of_joining
       or new.tracking_mode is distinct from old.tracking_mode then
      raise exception 'You are not allowed to modify these profile fields';
    end if;
    return new;
  end if;

  raise exception 'Not permitted';
end;
$fn$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.tg_profiles_guard();

-- ---------------------------------------------------------------------------
-- New workspaces: the founder is the owner.
--
-- 020's version of this function with one line added to the profile update.
-- See 013's header for why the org_name / app_role guards must not be
-- re-derived, and 020's for the domain-reservation handling.
-- ---------------------------------------------------------------------------
create or replace function public.provision_tenant_for_org()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_org_name  text;
  v_app_role  text;
  v_domain    text;
  v_taken     boolean;
  v_tenant_id uuid;
  v_board_id  uuid;
begin
  if new.role <> 'org' or new.tenant_id is not null then
    return new;
  end if;

  select nullif(btrim(coalesce(
           u.raw_user_meta_data ->> 'org_name',
           u.raw_user_meta_data ->> 'organization_name',
           ''
         )), ''),
         nullif(u.raw_app_meta_data ->> 'app_role', ''),
         nullif(btrim(lower(coalesce(u.raw_user_meta_data ->> 'org_domain', ''))), '')
    into v_org_name, v_app_role, v_domain
    from auth.users u
   where u.id = new.id;

  if v_app_role is not null and v_app_role <> 'org' then
    return new;
  end if;

  if v_org_name is null then
    return new;
  end if;

  if v_domain is not null
     and (length(v_domain) > 253
          or v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
          or v_domain ~ '^[0-9.]+$') then
    v_domain := null;
  end if;

  if v_domain is not null then
    perform public.release_expired_domain_claim(v_domain);
    select exists (select 1 from public.tenants where domain = v_domain) into v_taken;
    if v_taken then
      v_domain := null;
    end if;
  end if;

  insert into public.tenants (name, slug, domain, website)
  values (
    left(v_org_name, 120),
    public.tenant_slug_from(v_org_name),
    v_domain,
    v_domain
  )
  returning id into v_tenant_id;

  update public.profiles
     set tenant_id = v_tenant_id,
         role      = 'org',
         -- (027) Whoever creates the workspace owns it.
         is_owner  = true
   where id = new.id;

  insert into public.boards (tenant_id, name, created_by)
  values (v_tenant_id, 'Team Board', new.id)
  returning id into v_board_id;

  insert into public.board_columns (tenant_id, board_id, name, position)
  values
    (v_tenant_id, v_board_id, 'To Do',       0),
    (v_tenant_id, v_board_id, 'In Progress', 1),
    (v_tenant_id, v_board_id, 'Done',        2);

  insert into public.audit_logs (tenant_id, actor_id, actor_email, action, entity, entity_id, meta)
  values (v_tenant_id, new.id, new.email::text, 'tenant.provisioned', 'tenants', v_tenant_id,
          jsonb_build_object('name', v_org_name, 'domain', v_domain));

  return new;
end;
$fn$;
