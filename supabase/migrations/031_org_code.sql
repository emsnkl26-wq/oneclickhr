-- ---------------------------------------------------------------------------
-- 031 — Every workspace gets its own short code.
--
-- WHY. Employee IDs were minted as `EMP-0001`, which is the product's opinion,
-- not the organization's. Companies already have a short form they use on
-- badges, payroll files and invoices — "NKL" for Nextkin Life — and asking them
-- for it once at signup means every code the product generates afterwards reads
-- the way their existing paperwork does: NKL-0001, NKL-INV-0001.
--
-- NULLABLE, AND IT STAYS NULLABLE. Workspaces created before this migration
-- have live employee codes in the old series. Backfilling a code here does not
-- and must not rewrite those: `org_code` decides what the NEXT suggestion looks
-- like, nothing more. Renumbering a person whose ID is already on a signed
-- offer letter would be the more expensive kind of tidy.
-- ---------------------------------------------------------------------------

alter table public.tenants add column if not exists org_code text;

do $$
begin
  alter table public.tenants
    add constraint tenants_org_code_ck
    check (org_code is null or org_code ~ '^[A-Z][A-Z0-9]{1,5}$');
exception
  when duplicate_object then null;
end
$$;

/*
 * 013 revoked blanket SELECT/UPDATE on `tenants` and re-granted them column by
 * column, so a column added afterwards is INVISIBLE to a session until it is
 * named here — a client query that selects it 403s, and the settings save that
 * writes it fails. See the note at 013_domain_verification.sql:158.
 */
grant select (org_code) on public.tenants to authenticated;
grant update (org_code) on public.tenants to authenticated;

comment on column public.tenants.org_code is
  'Short organization prefix (2-6 chars, e.g. NKL) used when suggesting employee and invoice codes.';

-- ---------------------------------------------------------------------------
-- Deriving a code from a name, for the backfill and as the signup fallback.
--
-- Initials for a multi-word name ("Nextkin Life LLC" -> NLL), the first three
-- letters for a single-word one ("Acme" -> ACM). Punctuation and the company
-- suffixes that carry no signal are dropped first. The result is a SUGGESTION:
-- nothing here is unique, and two workspaces sharing a code is fine because the
-- codes it prefixes are only ever unique within one tenant.
-- ---------------------------------------------------------------------------
create or replace function public.org_code_from(p_name text)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $fn$
declare
  v_words text[];
  v_code  text;
begin
  -- Strip anything that is not a letter, a digit or a space, then drop the
  -- legal-form words so "Nextkin Life LLC" does not become NLL... it does, but
  -- "Acme Inc" becomes ACM rather than AI.
  select coalesce(array_agg(w order by ord), '{}'::text[])
    into v_words
    from unnest(regexp_split_to_array(
           btrim(regexp_replace(upper(coalesce(p_name, '')), '[^A-Z0-9 ]+', ' ', 'g')),
           '\s+'
         )) with ordinality as t(w, ord)
   where w <> ''
     and w <> all (array['LLC','INC','LTD','LIMITED','CORP','CORPORATION','PVT',
                         'PRIVATE','GMBH','PLC','CO','COMPANY','THE','AND']);

  if v_words is null or array_length(v_words, 1) is null then
    return null;
  end if;

  if array_length(v_words, 1) = 1 then
    v_code := left(v_words[1], 3);
  else
    select string_agg(left(w, 1), '' order by ord)
      into v_code
      from unnest(v_words) with ordinality as t(w, ord);
    v_code := left(v_code, 6);
  end if;

  -- The check constraint wants 2-6 chars starting with a letter. Anything that
  -- cannot satisfy it (a name that was all digits, or one letter long) becomes
  -- null, and the app falls back to the old EMP- series.
  if v_code is null or length(v_code) < 2 or v_code !~ '^[A-Z][A-Z0-9]{1,5}$' then
    return null;
  end if;

  return v_code;
end;
$fn$;

-- Backfill. Existing employee codes are untouched, on purpose (see header).
update public.tenants
   set org_code = public.org_code_from(name)
 where org_code is null;

-- ---------------------------------------------------------------------------
-- Provisioning: take the code the founder typed at signup.
--
-- 027's version of this function with the org_code read and insert added. The
-- org_name / app_role / domain handling below is carried over VERBATIM — see
-- 013's header for why the app_role guard must not be re-derived and 020's for
-- the domain-reservation handling.
--
-- The code arrives in `raw_user_meta_data`, which is user-controlled, so it is
-- validated here rather than trusted: anything that fails the shape falls back
-- to the derived code, and a derivation that also fails leaves it null.
-- ---------------------------------------------------------------------------
create or replace function public.provision_tenant_for_org()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_org_name  text;
  v_org_code  text;
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
         nullif(btrim(upper(coalesce(u.raw_user_meta_data ->> 'org_code', ''))), ''),
         nullif(u.raw_app_meta_data ->> 'app_role', ''),
         nullif(btrim(lower(coalesce(u.raw_user_meta_data ->> 'org_domain', ''))), '')
    into v_org_name, v_org_code, v_app_role, v_domain
    from auth.users u
   where u.id = new.id;

  if v_app_role is not null and v_app_role <> 'org' then
    return new;
  end if;

  if v_org_name is null then
    return new;
  end if;

  if v_org_code is null or v_org_code !~ '^[A-Z][A-Z0-9]{1,5}$' then
    v_org_code := public.org_code_from(v_org_name);
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

  insert into public.tenants (name, slug, org_code, domain, website)
  values (
    left(v_org_name, 120),
    public.tenant_slug_from(v_org_name),
    v_org_code,
    v_domain,
    v_domain
  )
  returning id into v_tenant_id;

  update public.profiles
     set tenant_id = v_tenant_id,
         role      = 'org',
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
          jsonb_build_object('name', v_org_name, 'domain', v_domain, 'org_code', v_org_code));

  return new;
end;
$fn$;
