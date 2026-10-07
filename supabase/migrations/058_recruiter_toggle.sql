-- ============================================================================
-- 058_recruiter_toggle.sql
--
-- Recruiter access is now an explicit boolean on the profile, toggled by the
-- org admin, instead of being derived from the designation text. This lets
-- any organization grant job portal access to any employee regardless of
-- their title or role name.
--
-- Re-runnable: every statement is idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add the column
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_recruiter boolean not null default false;

-- Grant the column to authenticated so RLS queries can read it, and the org
-- can toggle it through the employee edit form.
grant select (is_recruiter) on public.profiles to authenticated;
grant update (is_recruiter) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Backfill: anyone whose designation currently says "recruit" keeps access.
-- ---------------------------------------------------------------------------
update public.profiles
   set is_recruiter = true
 where role = 'employee'
   and is_active
   and designation ~* 'recruit'
   and not is_recruiter;

-- ---------------------------------------------------------------------------
-- 3. Replace app.is_recruiter() to use the boolean instead of the regex.
-- ---------------------------------------------------------------------------
create or replace function app.is_recruiter()
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and p.role = 'employee'
       and p.is_active
       and p.is_recruiter
  ) and app.is_active_member();
$$;
