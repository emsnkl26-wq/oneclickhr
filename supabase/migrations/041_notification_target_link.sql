-- ============================================================================
-- 041_notification_target_link.sql — what a notification is ABOUT.
--
-- The catalog in `lib/notifications/events.ts` already knows where each kind of
-- notification should land, and a web push has carried that path since 035. The
-- in-app list could not: the row recorded the title and the body but not which
-- event produced it, so "Timesheet TS-00001 approved" sat on the notifications
-- page as dead text while the same message on the device opened the timesheet.
--
-- These two columns close that gap. `event` is the catalog key, `subject_id` the
-- entity it concerns — the ticket, the timesheet, the task.
--
-- DELIBERATELY UNTYPED AND UNCONSTRAINED:
--
--   * `event` is text, not an enum. The catalog is application policy and gains
--     entries often; an enum would make every new notification kind a migration,
--     and a row whose event is not recognised already has a defined meaning —
--     `eventSpec` resolves an unknown key to `generic`.
--   * `subject_id` has no foreign key. It points at whichever table the event
--     implies, and the thing it points at is routinely deleted afterwards. A
--     notification about a closed ticket is still a true record of what someone
--     was told; the reader resolves a dangling id to a plain, unlinked card.
--
-- Both are nullable, so every row written before this migration keeps working
-- and simply does not link anywhere.
--
-- Re-runnable.
-- ============================================================================

alter table public.notifications
  add column if not exists event      text,
  add column if not exists subject_id uuid;

comment on column public.notifications.event is
  'Catalog key from lib/notifications/events.ts. Decides where the in-app card links. Unknown values resolve to generic.';
comment on column public.notifications.subject_id is
  'The entity this notification is about (ticket, timesheet, task). Intentionally no FK — the subject may be deleted.';
