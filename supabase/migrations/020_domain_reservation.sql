-- ============================================================================
-- 020_domain_reservation.sql
--
-- A CLAIMED DOMAIN IS NOW RESERVED, NOT MERELY DECLARED.
--
-- 013 deliberately let unverified claims collide: "a unique constraint on the
-- claim would let the first person to type acme.com lock the real Acme out of
-- the product forever." That reasoning was sound but it produced the opposite
-- bug in practice — a second person from the same company signs up on the same
-- domain, gets a second workspace, and nobody finds out until both have data in
-- them. Stopping exactly that was the whole point of 013.
--
-- WHAT MAKES THE RESERVATION SAFE IS THAT IT EXPIRES.
--
-- `domain_verify_due_at` (already on the table, already defaulting to 14 days)
-- stops being decoration and becomes the reservation's lifetime:
--
--   verified                        -> held forever. Unchanged from 013.
--   unverified, before the deadline -> held. Nobody else may claim it.
--   unverified, past the deadline   -> released the moment somebody else asks
--                                      for it. release_expired_domain_claim()
--                                      below is that release.
--
-- So the squatter of 013's nightmare holds acme.com for fourteen days and then
-- loses it to the first real Acme employee who signs up. That is a bounded,
-- self-healing failure instead of a permanent one.
--
-- Released on demand rather than by a scheduled sweep: nulling a workspace's
-- domain on a timer takes it away while nobody is asking for it, which is worse
-- for them than letting a dormant claim sit until it is actually contested.
--
-- The index is EXACT-MATCH ONLY. The wider rule (acme.com conflicts with
-- careers.acme.com) stays in src/lib/domain-registry.ts, where it always was:
-- it needs the label arithmetic in parentDomains(), and a partial index cannot
-- express it. The index is the race-proof floor; the app check is the ceiling.
--
-- Re-runnable.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. De-duplicate what the old rules allowed in
--
-- Before a unique index can exist, the duplicates 013 permitted have to go.
-- Priority: a verified claim always wins; otherwise the oldest workspace keeps
-- it, being the one most likely to hold real data. The losers keep `website`
-- (that is only letterhead display text) and lose `domain`, so their banner
-- asks for it again.
-- ---------------------------------------------------------------------------
with ranked as (
  select id,
         row_number() over (
           partition by domain
           order by (domain_verified_at is not null) desc, created_at asc, id asc
         ) as rank
    from public.tenants
   where domain is not null
)
update public.tenants t
   set domain = null,
       domain_verified_at = null,
       domain_verification_method = null
  from ranked r
 where t.id = r.id
   and r.rank > 1;

-- ---------------------------------------------------------------------------
-- 2. THE reservation
--
-- Supersedes tenants_verified_domain_uq, which it strictly contains: every
-- verified row is also a non-null row. The old index is dropped rather than
-- kept alongside, so there is one guarantee to reason about instead of two.
-- ---------------------------------------------------------------------------
create unique index if not exists tenants_domain_uq
  on public.tenants (domain)
  where domain is not null;

drop index if exists public.tenants_verified_domain_uq;

-- ---------------------------------------------------------------------------
-- 3. Releasing an expired claim
--
-- SECURITY DEFINER because the caller must not be able to write domain columns
-- directly — that is what 013 §3a (column privileges) and §3b (the guard
-- trigger) exist to prevent. This function is the ONE narrow exception, and it
-- can only ever do a single thing: blank an unverified, past-deadline claim. It
-- cannot touch a verified row, and it cannot set a domain on anything.
--
-- Returns how many claims it released, so a caller can tell "it was already
-- free" from "it was freed" when logging.
-- ---------------------------------------------------------------------------
create or replace function public.release_expired_domain_claim(p_domain text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_released integer;
begin
  if p_domain is null or btrim(p_domain) = '' then
    return 0;
  end if;

  update public.tenants
     set domain = null,
         domain_verification_method = null
   where domain = lower(btrim(p_domain))
     -- Proof is permanent. This function must never be able to unseat it.
     and domain_verified_at is null
     -- A null deadline is an unbounded reservation, not an expired one.
     and domain_verify_due_at is not null
     and domain_verify_due_at < now();

  get diagnostics v_released = row_count;
  return v_released;
end;
$fn$;

revoke all on function public.release_expired_domain_claim(text) from public;
grant execute on function public.release_expired_domain_claim(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Provisioning must not die on a contested domain
--
-- 013's version inserted the claim blind, which under §2's index would abort the
-- whole signup transaction with a 23505 — the new workspace would never exist,
-- because somebody else had already typed the same website. Same principle as
-- 013's shape check: an unusable domain is DROPPED, never fatal. The banner asks
-- for it again on first sign-in, and /api/org/domain gives the real explanation.
--
-- Otherwise byte-for-byte 013's function. See its header for why the org_name
-- and app_role guards must not be re-derived from the 003 version.
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

  -- Contested? Give up an expired reservation first, then look again. Dropping
  -- the domain is the fallback; failing the signup is never an option.
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
    -- Seeds the letterhead's display website too, so nobody retypes it.
    v_domain
  )
  returning id into v_tenant_id;

  update public.profiles
     set tenant_id = v_tenant_id,
         role      = 'org'
   where id = new.id;

  -- Seed the default Kanban board so the workspace is never an empty shell.
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
