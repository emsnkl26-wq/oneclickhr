-- ============================================================================
-- 012_profiles_and_letters.sql
--
-- Three related additions:
--   1. The richer employee profile — work history, education, skills.
--   2. The company details a letterhead needs, on `tenants`.
--   3. `generated_documents`, the record of every letter the system has issued.
--
-- Nothing here changes an existing column's meaning; every ALTER is additive
-- and every ADD COLUMN is `if not exists`, so this is safe on a live database.
-- ============================================================================

do $$ begin
  create type public.generated_document_type as enum (
    'offer_letter',          -- the short "Offer of Employment – <title>" letter
    'employment_agreement',  -- the numbered, multi-page agreement
    'internship_offer'       -- the internship / short-form offer
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. Employee profile
-- ---------------------------------------------------------------------------

/**
 * Skills as a jsonb array of plain strings.
 *
 * A join table would buy normalisation nobody needs here: skills are never
 * queried across employees, they are shown as a row of pills on one profile,
 * and the whole set is replaced in a single save. `tg_profiles_guard` does not
 * list this column among the privileged ones, so an employee may edit their own
 * — which is the point.
 */
alter table public.profiles
  add column if not exists skills jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.profiles
    add constraint profiles_skills_array_ck check (jsonb_typeof(skills) = 'array');
exception when duplicate_object then null; end $$;

create table if not exists public.employee_experience (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  company_name text not null check (length(btrim(company_name)) between 1 and 160),
  role_title  text not null check (length(btrim(role_title)) between 1 and 160),
  start_date  date,
  end_date    date,
  -- Null end_date reads as "present" in the UI; the flag keeps that explicit so
  -- an unfinished form is not mistaken for a current role.
  is_current  boolean not null default false,
  summary     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint employee_experience_range_ck
    check (end_date is null or start_date is null or end_date >= start_date)
);

drop trigger if exists set_updated_at on public.employee_experience;
create trigger set_updated_at before update on public.employee_experience
  for each row execute function public.tg_set_updated_at();

create index if not exists employee_experience_employee_idx
  on public.employee_experience (employee_id, start_date desc nulls last);
create index if not exists employee_experience_tenant_idx on public.employee_experience (tenant_id);

create table if not exists public.employee_education (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  employee_id     uuid not null references public.profiles(id) on delete cascade,
  institution     text not null check (length(btrim(institution)) between 1 and 160),
  degree          text not null check (length(btrim(degree)) between 1 and 160),
  field_of_study  text,
  completion_year integer check (completion_year is null or completion_year between 1900 and 2200),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.employee_education;
create trigger set_updated_at before update on public.employee_education
  for each row execute function public.tg_set_updated_at();

create index if not exists employee_education_employee_idx
  on public.employee_education (employee_id, completion_year desc nulls last);
create index if not exists employee_education_tenant_idx on public.employee_education (tenant_id);

-- ---------------------------------------------------------------------------
-- 2. Company details for the letterhead
--
-- Everything a generated document prints at the top of the page. It lives on
-- `tenants` rather than in a settings blob because each field is edited, shown
-- and validated on its own, and because a document must never fall back to OUR
-- details when an org has not filled one in — a missing line is simply omitted.
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists address_line1       text,
  add column if not exists address_line2       text,
  add column if not exists city                text,
  add column if not exists state_province      text,
  add column if not exists postal_code         text,
  add column if not exists country             text,
  -- EIN, CIN, company number — whatever this jurisdiction calls it.
  add column if not exists registration_number text,
  add column if not exists company_email       text,
  add column if not exists company_phone       text,
  add column if not exists website             text,
  -- Defaults for the signature block on a generated letter.
  add column if not exists signatory_name      text,
  add column if not exists signatory_title     text,
  add column if not exists signatory_phone     text;

-- ---------------------------------------------------------------------------
-- 3. generated_documents
--
-- `file_url` is the R2 object key, exactly like payslips — never a public URL.
-- `payload` is the form the org filled in, kept so a letter can be re-issued
-- with one field changed instead of retyped. It holds no secrets: names, dates,
-- a salary figure and boilerplate that is printed on the document itself.
-- ---------------------------------------------------------------------------
create table if not exists public.generated_documents (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  doc_type    public.generated_document_type not null,
  title       text not null check (length(btrim(title)) between 1 and 200),
  file_url    text not null,
  file_name   text,
  -- The `documents` row finalize created for the same object, so removing a
  -- letter can remove its library entry too.
  document_id uuid references public.documents(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists set_updated_at on public.generated_documents;
create trigger set_updated_at before update on public.generated_documents
  for each row execute function public.tg_set_updated_at();

create index if not exists generated_documents_tenant_idx
  on public.generated_documents (tenant_id, created_at desc);
create index if not exists generated_documents_employee_idx
  on public.generated_documents (employee_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.employee_experience  enable row level security;
alter table public.employee_education   enable row level security;
alter table public.generated_documents  enable row level security;

alter table public.employee_experience force row level security;
alter table public.employee_education  force row level security;
alter table public.generated_documents force row level security;

/*
 * Experience and education follow one rule, stated twice because the tables are
 * separate: the org reads (and may correct) anything in its tenant; an employee
 * reads and writes only their own rows. `employee_id = auth.uid()` in the WITH
 * CHECK is what stops someone appending a job history to a colleague.
 */
drop policy if exists employee_experience_select on public.employee_experience;
create policy employee_experience_select on public.employee_experience for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or employee_id = (select auth.uid()))
  )
);

drop policy if exists employee_experience_write on public.employee_experience;
create policy employee_experience_write on public.employee_experience for all to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or employee_id = (select auth.uid()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or employee_id = (select auth.uid()))
);

drop policy if exists employee_education_select on public.employee_education;
create policy employee_education_select on public.employee_education for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or employee_id = (select auth.uid()))
  )
);

drop policy if exists employee_education_write on public.employee_education;
create policy employee_education_write on public.employee_education for all to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or employee_id = (select auth.uid()))
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and ((select app.is_org()) or employee_id = (select auth.uid()))
);

-- Letters: the org issues them; the employee they name may read their own.
drop policy if exists generated_documents_select on public.generated_documents;
create policy generated_documents_select on public.generated_documents for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and ((select app.is_org()) or employee_id = (select auth.uid()))
  )
);

drop policy if exists generated_documents_write on public.generated_documents;
create policy generated_documents_write on public.generated_documents for all to authenticated
using  (tenant_id = (select app.current_tenant_id()) and (select app.is_org()))
with check (tenant_id = (select app.current_tenant_id()) and (select app.is_org()));

analyze public.employee_experience;
analyze public.employee_education;
analyze public.generated_documents;
