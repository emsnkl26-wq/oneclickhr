-- ============================================================================
-- 060_local_jwt_verification.sql — let the server verify a caller without
-- asking the auth server.
--
-- WHY
--
-- `src/lib/auth/context.ts` resolves the caller once per request. Until now it
-- did that with two PARALLEL round trips: `getUser()`, which asks the auth
-- server to vouch for the access token, and `current_profile()`, which reads
-- the live profile. Parallel, so the cost was the slower of the two — and
-- measured against this project, `/auth/v1/user` is consistently about three
-- times slower than PostgREST (~490ms against ~160ms). `getUser()` therefore
-- set the latency floor under EVERY authenticated page and API call.
--
-- This project signs its JWTs with ES256 (its JWKS endpoint publishes a single
-- EC P-256 key), so the signature can be verified locally with WebCrypto, with
-- no network at all. That removes the slower of the two trips.
--
-- WHAT THAT WOULD COST, AND WHY THIS FUNCTION EXISTS
--
-- A locally verified JWT proves the token is genuine and unexpired. It does NOT
-- prove the session behind it still exists. Signing out everywhere, changing a
-- password, or an admin revoking a session all delete the row in
-- `auth.sessions` — and `getUser()` noticed that immediately, where local
-- verification would keep honouring a stolen token until it expired.
--
-- For a product holding payroll, bank details and visa documents, trading that
-- away for latency is not a trade worth making. So it is not traded away: the
-- session check moves INTO the `current_profile()` round trip we were already
-- paying for. The result is strictly better than before — same revocation
-- guarantee, one less round trip.
--
-- SAFETY — the reason this is two functions and not one inlined expression
--
-- `current_profile()` is the single point of failure for the entire product: if
-- it throws, every guard treats the caller as unresolvable and nobody can sign
-- in. Reading `auth.sessions` is exactly the kind of thing that can fail at
-- RUNTIME rather than at CREATE time — the `auth` schema is owned by
-- `supabase_auth_admin`, and a permission problem there would not surface until
-- the first real request, by which point it is an outage.
--
-- So the session lookup lives in its own PL/pgSQL function with an exception
-- handler that answers NULL — "cannot determine" — for ANY failure. NULL is a
-- defined answer, not an error: the application reads it as "no revocation
-- evidence" and falls back to asking the auth server, which is precisely the
-- behaviour it had before this migration. A broken session check therefore
-- costs latency and nothing else. It can never lock anybody out, and it can
-- never silently let a revoked token through either.
--
-- Re-runnable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Is the session behind the caller's JWT still live?
--
--   true   the session row exists and has not been timed out
--   false  the JWT names a session that is gone — signed out, or revoked
--   null   cannot tell (no `session_id` claim, or `auth.sessions` unreadable)
--
-- PL/pgSQL rather than SQL on purpose: only PL/pgSQL can catch the exception,
-- and only PL/pgSQL defers resolving `auth.sessions` to runtime so that
-- creating this function cannot fail on a database where it is not visible.
-- ----------------------------------------------------------------------------
create or replace function public.auth_session_active()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
declare
  sid text := nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'session_id', '');
begin
  -- No session claim at all: service-role calls and older tokens have none.
  -- Not an error, and emphatically not a revocation — say "unknown".
  if sid is null then
    return null;
  end if;

  -- Shape-checked before the cast. A malformed value would otherwise raise
  -- `invalid input syntax for type uuid`, and an exception here is the one
  -- outcome this function exists to prevent.
  if sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return exists (
    select 1
      from auth.sessions s
     where s.id = sid::uuid
       -- `not_after` is how a time-boxed session expires. Null is the usual
       -- case and means "no cut-off".
       and (s.not_after is null or s.not_after > now())
  );
exception
  when others then
    -- Unreadable for any reason. Report "unknown" so the caller falls back to
    -- the auth server rather than treating a healthy user as signed out.
    return null;
end;
$$;

revoke execute on function public.auth_session_active() from anon, public;
grant execute on function public.auth_session_active() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- `current_profile()` — 034's version, plus `session_active`.
--
-- The column is appended LAST so the shape stays additive: every existing
-- consumer reads by name and is unaffected.
--
-- `drop function` first because the RETURNS TABLE signature changes, and
-- `create or replace` cannot alter a function's result type. The pair is
-- atomic — migrations run inside a transaction, so if the create fails the
-- drop rolls back with it and the old function is still there.
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
  session_active boolean
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
         public.auth_session_active()
    from public.profiles p
    left join public.tenants t on t.id = p.tenant_id
   where p.id = auth.uid();
$$;

revoke execute on function public.current_profile() from anon, public;
grant execute on function public.current_profile() to authenticated, service_role;
