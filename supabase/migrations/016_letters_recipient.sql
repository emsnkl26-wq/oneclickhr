-- ---------------------------------------------------------------------------
-- 016 — A letter is addressed to a PERSON, not to an account.
--
-- The generator used to require picking an employee, which had the order of
-- events backwards: an offer letter is what you send BEFORE somebody exists in
-- the system. They accept it, they onboard, and only then is there a profile to
-- point at. Requiring the profile first meant every org had to create a fake
-- employee record to send an offer, and then either keep it or clean it up.
--
-- So the recipient becomes plain text, and the employee link becomes optional —
-- kept for the case that still has one, which is generating a document from an
-- existing employee's page.
--
--   • `employee_id` drops NOT NULL.
--   • `recipient_name` / `recipient_email` record who the letter names.
--   • A row must carry at least a name, so nothing is addressed to nobody.
--
-- Existing rows are backfilled from the profile they already point at, which
-- lets the list screen read one column instead of branching on a join.
-- ---------------------------------------------------------------------------

alter table public.generated_documents
  alter column employee_id drop not null;

alter table public.generated_documents
  add column if not exists recipient_name  text,
  add column if not exists recipient_email text;

update public.generated_documents as g
set recipient_name  = coalesce(nullif(btrim(p.full_name), ''), p.email, 'Employee'),
    recipient_email = p.email
from public.profiles as p
where p.id = g.employee_id
  and g.recipient_name is null;

-- Anything left is a row whose profile is already gone; the title still names it.
update public.generated_documents
set recipient_name = 'Recipient'
where recipient_name is null or btrim(recipient_name) = '';

alter table public.generated_documents
  alter column recipient_name set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.generated_documents'::regclass
      and conname = 'generated_documents_recipient_name_check'
  ) then
    alter table public.generated_documents
      add constraint generated_documents_recipient_name_check
      check (length(btrim(recipient_name)) between 1 and 160);
  end if;
end $$;

-- The list screen filters on the recipient's name; without this it is a table
-- scan on every search in a workspace that has issued a few thousand letters.
create index if not exists generated_documents_recipient_idx
  on public.generated_documents (tenant_id, recipient_name);

-- ---------------------------------------------------------------------------
-- RLS is unchanged in intent but re-stated for clarity: a letter with no
-- employee_id is org-only, because `employee_id = auth.uid()` is never true for
-- NULL. That is exactly right — an unaccepted offer belongs to the org until the
-- person it names has an account to read it with.
-- ---------------------------------------------------------------------------

analyze public.generated_documents;
