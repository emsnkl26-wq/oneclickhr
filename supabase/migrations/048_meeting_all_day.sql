-- ============================================================================
-- 048_meeting_all_day.sql — an all-day Google event is a DATE, not an instant.
--
-- Until now a Google all-day event ("Team offsite", 22 Sep) was stored as
--
--     start_time = 2026-09-22T00:00:00Z
--     end_time   = <Google's end.date>T23:59:59Z
--
-- which is wrong twice:
--
--   1. Midnight UTC is the evening of the 21st anywhere in the Americas, so
--      the calendar — which places timed entries on the viewer's local day —
--      put the event on the previous day.
--   2. Google's `end.date` is EXCLUSIVE. A one-day event on the 22nd has
--      end.date = the 23rd, so the row claimed to run to 23:59 on the 23rd.
--
-- `all_day` lets the calendar treat these rows as the calendar dates they
-- are (read in UTC, where they were written, so they never shift), and the
-- sync now stores the inclusive last day (src/lib/google-calendar.ts).
--
-- Rows already synced are repaired below: a Google row that starts exactly on
-- a UTC midnight and ends exactly on 23:59:59 UTC is one of these, and its end
-- moves back the day Google's exclusive end added. The next sync rewrites them
-- anyway; the backfill just means nobody waits for it.
--
-- Re-runnable: only rows not yet flagged are touched.
-- ============================================================================

alter table public.meetings
  add column if not exists all_day boolean not null default false;

update public.meetings
   set all_day  = true,
       end_time = case
                    when end_time - interval '1 day' > start_time
                      then end_time - interval '1 day'
                    else end_time
                  end
 where source = 'google'
   and all_day = false
   and (start_time at time zone 'UTC')::time = time '00:00:00'
   and (end_time   at time zone 'UTC')::time = time '23:59:59';
