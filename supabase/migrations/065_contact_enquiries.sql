-- ============================================================================
-- 065_contact_enquiries.sql — enquiries from the public marketing site land in
-- the platform console (super admin), not just an inbox.
--
-- WHAT
--
--   public.contact_enquiries   One row per submission of the landing site's
--                              contact form (oneclickhr-landing). Captures who
--                              wrote in, their organization and team size, what
--                              they need and the message, plus a status so the
--                              platform team can work through them.
--
-- WHO IT COVERS: nobody's tenant. These are PROSPECTS, not members of any
-- workspace, so the table is platform-level and carries no tenant_id. The only
-- people who read it are super admins, through the service-role client — exactly
-- like every other cross-tenant read in the platform console.
--
-- RLS: enabled and FORCED with NO policies for `authenticated`. That is the
-- access model: a signed-in org user or employee has no business reading sales
-- enquiries, so they can read nothing here. The landing site writes through a
-- server-to-server ingest route that uses the service role (which bypasses RLS),
-- and the super console reads the same way. No `authenticated` grant is issued.
--
-- Re-runnable.
-- ============================================================================

create table if not exists public.contact_enquiries (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  company     text not null,
  team_size   text,
  enquiry     text,
  message     text not null,
  -- 'new' until a super admin reads it; 'read' / 'archived' as they work it.
  status      text not null default 'new' check (status in ('new', 'read', 'archived')),
  -- Where it came from and light request context, for triage only.
  source      text not null default 'landing',
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists contact_enquiries_created_idx
  on public.contact_enquiries (created_at desc);
create index if not exists contact_enquiries_status_idx
  on public.contact_enquiries (status);

drop trigger if exists set_updated_at on public.contact_enquiries;
create trigger set_updated_at before update on public.contact_enquiries
  for each row execute function public.tg_set_updated_at();

alter table public.contact_enquiries enable row level security;
alter table public.contact_enquiries force  row level security;

-- Deliberately NO policies: `authenticated` reaches none of these rows. The
-- ingest route and the super console both use the service-role client, which is
-- not subject to RLS. Revoke any inherited grants to be explicit about it.
revoke all on public.contact_enquiries from authenticated;
revoke all on public.contact_enquiries from anon;
