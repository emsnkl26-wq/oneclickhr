-- ============================================================================
-- 021_job_location.sql
--
-- A JOB'S LOCATION BECOMES STRUCTURED.
--
-- `location` was one free-text box, so "Bengaluru, India", "bangalore",
-- "Bengaluru, KA" and "Remote - India" were four different places as far as
-- anything downstream was concerned. Nothing could filter, group or map on it.
--
-- The four new columns are what the form now collects. `location` STAYS, and
-- stays exactly where it was, because it is what the public job board and the
-- application emails print — it simply stops being typed and starts being
-- DERIVED from the parts, by formatLocation() in src/lib/geo.ts.
--
-- Why derived in application code rather than a GENERATED column: the country
-- has to be rendered as a name ("India", not "IN"), and that mapping lives in
-- TypeScript alongside the dropdown that produced it. A generated column would
-- need a second copy of the country list in SQL, and the two would drift.
--
-- Existing rows keep their typed `location` and have null parts. That is a
-- legitimate state, not a migration to finish: re-parsing free text into
-- countries and states would guess, and a wrong guess on a live job posting is
-- worse than an honestly unstructured one. Editing a job fills the parts in.
--
-- Re-runnable.
-- ============================================================================

alter table public.jobs
  add column if not exists country text,
  add column if not exists state   text,
  add column if not exists city    text,
  add column if not exists address text;

-- Lengths mirror the zod schema, which is the friendly check; these are the
-- guarantee. `country` is an ISO 3166-1 alpha-2 code, hence 2.
do $$
begin
  alter table public.jobs add constraint jobs_country_ck
    check (country is null or country ~ '^[A-Z]{2}$');
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.jobs add constraint jobs_state_len_ck
    check (state is null or length(state) <= 100);
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.jobs add constraint jobs_city_len_ck
    check (city is null or length(city) <= 100);
exception when duplicate_object then null; end $$;

do $$
begin
  alter table public.jobs add constraint jobs_address_len_ck
    check (address is null or length(address) <= 200);
exception when duplicate_object then null; end $$;

-- Backs "jobs in this country/state", which is the reason for the whole change.
-- Partial: a posting with no country contributes nothing to such a filter.
create index if not exists jobs_location_idx
  on public.jobs (country, state)
  where country is not null;
