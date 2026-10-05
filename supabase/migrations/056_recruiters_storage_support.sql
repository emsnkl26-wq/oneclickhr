-- ============================================================================
-- 056_recruiters_storage_support.sql
--
--   1. 1099 EMPLOYMENT TYPE for job postings (independent contractor).
--
--   2. COMPANY LINKEDIN on the workspace. A posting that does not name its own
--      company page shows this one.
--
--   3. RECRUITERS RUN THE JOB PORTAL. An active employee whose designation says
--      they recruit ("Recruiter", "Senior Technical Recruiter", "Recruitment
--      Lead") may create, edit, publish and close the workspace's postings and
--      review their applicants — the same access the org has to `jobs` and
--      `job_applications`, and nothing else.
--
--   4. EMPLOYER-ADDED EMPLOYEE DOCUMENTS (see section 4).
--
--   5. TWO-WAY SUPPORT. The platform answers a support request and the org
--      reads the answer in its portal.
--
--   3b. SIGN IN WITH GOOGLE — service-role helpers that keep one address to
--      one way in, and build the workspace for a Google sign-up.
--
--   6. STORAGE QUOTA. 1 GB per workspace by default; an org asks for more with
--      a reason, a super admin raises the limit by hand.
--
--   7. INVOICE LAYOUT. 'modern' for invoices written on the Invoices page,
--      'classic' (every existing row) for those generated from timesheets.
--
-- Re-runnable: every statement is idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 1099
-- ---------------------------------------------------------------------------
alter type public.job_type add value if not exists '1099';

-- ---------------------------------------------------------------------------
-- 2. Company LinkedIn
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists company_linkedin_url text;

do $$ begin
  alter table public.tenants add constraint tenants_company_linkedin_url_ck
    check (
      company_linkedin_url is null
      or (length(company_linkedin_url) <= 400 and company_linkedin_url ~* '^https://[^[:space:]]+$')
    );
exception when duplicate_object then null; end $$;

-- 013 grants `tenants` columns one by one, so a new column must be granted too.
grant select (company_linkedin_url) on public.tenants to authenticated;
grant update (company_linkedin_url) on public.tenants to authenticated;

comment on column public.tenants.company_linkedin_url is
  'The company LinkedIn page. Shown on every job posting that does not set its own.';

-- ---------------------------------------------------------------------------
-- 3. Recruiters
-- ---------------------------------------------------------------------------

/**
 * Is the caller an active recruiter of their workspace?
 *
 * Read from the profile on every check (never the JWT), like is_active: taking
 * "Recruiter" off someone's designation removes the access on the next request.
 */
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
       and p.designation ~* 'recruit'
  ) and app.is_active_member();
$$;

revoke execute on function app.is_recruiter() from anon, public;
grant  execute on function app.is_recruiter() to authenticated, service_role;

drop policy if exists jobs_select on public.jobs;
create policy jobs_select on public.jobs for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and ((select app.is_org()) or (select app.is_recruiter()))
  )
  or (status = 'published' and (select app.is_employee()) and (select app.is_active_member()))
);

drop policy if exists jobs_write on public.jobs;
create policy jobs_write on public.jobs for all to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or (select app.is_recruiter()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or (select app.is_recruiter()))
);

drop policy if exists job_applications_select on public.job_applications;
create policy job_applications_select on public.job_applications for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and ((select app.is_org()) or (select app.is_recruiter()))
  )
  or applicant_profile_id = (select auth.uid())
);

drop policy if exists job_applications_update on public.job_applications;
create policy job_applications_update on public.job_applications for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or (select app.is_recruiter()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and ((select app.is_org()) or (select app.is_recruiter()))
);

drop policy if exists job_application_events_select on public.job_application_events;
create policy job_application_events_select on public.job_application_events for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and ((select app.is_org()) or (select app.is_recruiter()))
  )
  or applicant_profile_id = (select auth.uid())
);

-- ---------------------------------------------------------------------------
-- 3b. Sign in with Google
--
-- One address, one way in. An account created with a password signs in with
-- that password; an account created through Google signs in through Google.
-- Supabase links a Google identity onto an existing verified account with the
-- same address on its own, so the callback asks which providers an account
-- has, and strips a Google identity that arrived on a password account.
-- All three functions are service-role only.
-- ---------------------------------------------------------------------------

/** The sign-in providers an address is registered with ('email', 'google', …). */
create or replace function public.auth_providers_for_email(p_email text)
returns text[]
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(array_agg(distinct i.provider order by i.provider), '{}')
    from auth.users u
    join auth.identities i on i.user_id = u.id
   where lower(u.email) = lower(btrim(p_email));
$$;

revoke all on function public.auth_providers_for_email(text) from public, anon, authenticated;
grant execute on function public.auth_providers_for_email(text) to service_role;

/**
 * Remove a Google identity that Supabase auto-linked onto a password account.
 * Refuses to remove the account's ONLY identity — that would orphan the user.
 */
create or replace function public.remove_google_identity(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if (select count(*) from auth.identities where user_id = p_user_id and provider <> 'google') = 0 then
    return;
  end if;
  delete from auth.identities where user_id = p_user_id and provider = 'google';
end;
$$;

revoke all on function public.remove_google_identity(uuid) from public, anon, authenticated;
grant execute on function public.remove_google_identity(uuid) to service_role;

/**
 * Give a Google sign-up its workspace.
 *
 * An email sign-up carries the organization's name in its metadata, so
 * `provision_tenant_for_org()` builds the workspace the moment the profile is
 * inserted. A Google sign-up has no such form — its profile is created bare,
 * with role 'org' and no tenant — so /signup/complete collects the details,
 * writes them to the user's metadata, and calls this. Same rules as 031's
 * trigger, applied to a profile that already exists. Returns the tenant id.
 */
create or replace function public.provision_tenant_for_existing_org(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare
  v_profile   public.profiles%rowtype;
  v_org_name  text;
  v_org_code  text;
  v_domain    text;
  v_taken     boolean;
  v_tenant_id uuid;
  v_board_id  uuid;
begin
  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'no profile for user';
  end if;
  if v_profile.role <> 'org' then
    raise exception 'only an organization account can create a workspace';
  end if;
  if v_profile.tenant_id is not null then
    return v_profile.tenant_id;
  end if;

  select nullif(btrim(coalesce(u.raw_user_meta_data ->> 'org_name', '')), ''),
         nullif(btrim(upper(coalesce(u.raw_user_meta_data ->> 'org_code', ''))), ''),
         nullif(btrim(lower(coalesce(u.raw_user_meta_data ->> 'org_domain', ''))), '')
    into v_org_name, v_org_code, v_domain
    from auth.users u
   where u.id = p_user_id;

  if v_org_name is null then
    raise exception 'organization name is required';
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
  values (left(v_org_name, 120), public.tenant_slug_from(v_org_name), v_org_code, v_domain, v_domain)
  returning id into v_tenant_id;

  update public.profiles
     set tenant_id = v_tenant_id,
         role      = 'org',
         is_owner  = true,
         full_name = coalesce(full_name, (select nullif(btrim(raw_user_meta_data ->> 'full_name'), '') from auth.users where id = p_user_id))
   where id = p_user_id;

  insert into public.boards (tenant_id, name, created_by)
  values (v_tenant_id, 'Team Board', p_user_id)
  returning id into v_board_id;

  insert into public.board_columns (tenant_id, board_id, name, position)
  values
    (v_tenant_id, v_board_id, 'To Do',       0),
    (v_tenant_id, v_board_id, 'In Progress', 1),
    (v_tenant_id, v_board_id, 'Done',        2);

  insert into public.audit_logs (tenant_id, actor_id, actor_email, action, entity, entity_id, meta)
  values (v_tenant_id, p_user_id, v_profile.email::text, 'tenant.provisioned', 'tenants', v_tenant_id,
          jsonb_build_object('name', v_org_name, 'domain', v_domain, 'org_code', v_org_code, 'via', 'google'));

  return v_tenant_id;
end;
$fn$;

revoke all on function public.provision_tenant_for_existing_org(uuid) from public, anon, authenticated;
grant execute on function public.provision_tenant_for_existing_org(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Employer-added employee documents need no schema change: `documents`
--    already carries `employee_id` and `label`, and `documents_write` lets the
--    org write and delete its own rows.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 5. Two-way support
--
-- A request is now a THREAD: the original message on `support_requests`, then
-- `support_messages` in order — the platform's replies and the requester's
-- follow-ups. The requester can now read their OWN requests (028 let only the
-- platform read them), so the portal can show the conversation.
-- ---------------------------------------------------------------------------
drop policy if exists support_requests_select on public.support_requests;
create policy support_requests_select on public.support_requests
for select to authenticated
using (
  (select app.is_super_admin())
  or (profile_id = (select auth.uid()) and (select app.is_active_member()))
);

alter table public.support_requests
  add column if not exists last_reply_at timestamptz,
  -- True when the platform has written something the requester has not seen.
  add column if not exists requester_unread boolean not null default false;

create table if not exists public.support_messages (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.support_requests(id) on delete cascade,
  -- Denormalised from the request so the read policy is a plain comparison.
  requester_id  uuid references public.profiles(id) on delete set null,
  author_id     uuid references public.profiles(id) on delete set null,
  from_platform boolean not null,
  author_name   text check (author_name is null or length(author_name) <= 160),
  body          text not null check (length(btrim(body)) between 1 and 5000),
  created_at    timestamptz not null default now()
);

create index if not exists support_messages_request_idx
  on public.support_messages (request_id, created_at);

alter table public.support_messages enable row level security;
alter table public.support_messages force row level security;

drop policy if exists support_messages_select on public.support_messages;
create policy support_messages_select on public.support_messages
for select to authenticated
using (
  (select app.is_super_admin())
  or (requester_id = (select auth.uid()) and (select app.is_active_member()))
);

-- Writes go through the API with the service role (it also stamps the request
-- and notifies), so ordinary sessions get no write path at all.
revoke insert, update, delete on public.support_messages from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 6. Storage quota
--
-- Usage is a running total on the tenant, added to by /api/files/finalize —
-- which already learns every object's size — and released when a document is
-- deleted. The limit defaults to 1 GB; only a super admin raises it. Asking for
-- more is a row in `storage_requests`.
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists storage_limit_bytes bigint not null default 1073741824,
  add column if not exists storage_used_bytes  bigint not null default 0;

do $$ begin
  alter table public.tenants add constraint tenants_storage_nonneg_ck
    check (storage_limit_bytes >= 0 and storage_used_bytes >= 0);
exception when duplicate_object then null; end $$;

-- Readable by members (Settings shows the usage); NOT writable by a session —
-- only the service role moves either number.
grant select (storage_limit_bytes, storage_used_bytes) on public.tenants to authenticated;

/** Add (or, with a negative delta, release) bytes against a workspace. */
create or replace function public.add_storage_used(p_tenant_id uuid, p_delta bigint)
returns bigint
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.tenants
     set storage_used_bytes = greatest(0, storage_used_bytes + p_delta)
   where id = p_tenant_id
  returning storage_used_bytes;
$$;

revoke all on function public.add_storage_used(uuid, bigint) from public, anon, authenticated;
grant execute on function public.add_storage_used(uuid, bigint) to service_role;

-- Backfill from what is already recorded with a size. Only `documents` carries
-- sizes from before this migration, so older photos and payslips are not
-- counted — the total errs low, never high. Runs only while a tenant's total
-- is still zero, so re-running this file does not double it.
update public.tenants t
   set storage_used_bytes = sub.total
  from (
    select tenant_id, coalesce(sum(size_bytes), 0)::bigint as total
      from public.documents
     where size_bytes is not null
     group by tenant_id
  ) sub
 where sub.tenant_id = t.id
   and t.storage_used_bytes = 0;

do $$ begin
  create type public.storage_request_status as enum ('pending', 'approved', 'declined');
exception when duplicate_object then null; end $$;

create table if not exists public.storage_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  requested_by    uuid references public.profiles(id) on delete set null,
  requested_bytes bigint not null check (requested_bytes > 0),
  reason          text not null check (length(btrim(reason)) between 3 and 2000),
  status          public.storage_request_status not null default 'pending',
  granted_bytes   bigint,
  admin_note      text check (admin_note is null or length(admin_note) <= 2000),
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists storage_requests_queue_idx on public.storage_requests (status, created_at desc);
create index if not exists storage_requests_tenant_idx on public.storage_requests (tenant_id, created_at desc);

alter table public.storage_requests enable row level security;
alter table public.storage_requests force row level security;

drop policy if exists storage_requests_select on public.storage_requests;
create policy storage_requests_select on public.storage_requests
for select to authenticated
using (
  (select app.is_super_admin())
  or (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
);

-- Writes (the org's request and the platform's decision) go through the API
-- with the service role, after their own checks.
revoke insert, update, delete on public.storage_requests from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 7. Invoice layout
--
-- Invoices generated from an employee's timesheets keep the classic boxed
-- staffing invoice; invoices written on the Invoices page print the modern
-- one. Every existing invoice is classic, which is what it was issued as.
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists layout text not null default 'classic';

do $$ begin
  alter table public.invoices add constraint invoices_layout_ck
    check (layout in ('classic', 'modern'));
exception when duplicate_object then null; end $$;
