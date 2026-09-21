-- ============================================================================
-- 044_timesheet_attachments.sql — a week can carry any number of files.
--
-- Clients export time in pieces: a PDF from one system, a spreadsheet from
-- another, a photo of the signed sheet. One `attachment_url` per week forced a
-- choice between them.
--
--   timesheets.attachments   jsonb array of { key, name }, in upload order.
--
-- `attachment_url` / `attachment_name` stay, mirrored to the FIRST file, so the
-- list pages that only ask "is there a file?" keep working unchanged.
--
-- RLS: nothing new — a column on an already-scoped table.
--
-- Re-runnable.
-- ============================================================================

alter table public.timesheets
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$ begin
  alter table public.timesheets add constraint timesheets_attachments_array_ck
    check (jsonb_typeof(attachments) = 'array');
exception when duplicate_object then null; end $$;

-- Weeks saved before this migration: their one file becomes the first entry.
update public.timesheets
   set attachments = jsonb_build_array(
         jsonb_build_object('key', attachment_url, 'name', coalesce(attachment_name, 'Attachment'))
       )
 where attachment_url is not null
   and attachments = '[]'::jsonb;
