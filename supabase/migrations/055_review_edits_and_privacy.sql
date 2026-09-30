-- ============================================================================
-- 055_review_edits_and_privacy.sql
--
--   1. MEETINGS ARE PRIVATE TO THEIR INVITEES. 002 let every member of a
--      workspace read every meeting, so an employee's calendar showed meetings
--      they were never invited to. An employee now sees a meeting only when
--      they organised it or their address is on its attendee list. The org
--      still sees everything — it schedules them.
--
--   2. THE ORG CORRECTS HOURS BEFORE APPROVING. The entry policies already let
--      the org write lines; they are narrowed so it can only do so while the
--      week is SUBMITTED. An approved week has been paid (pay_amount is
--      snapshotted) and may have been invoiced — its hours must not move under
--      either.
--
--   3. ATTENDANCE CORRECTIONS ARE ATTRIBUTED. A forgotten clock-out left a
--      shift open for days; the org can now close or fix it, and the row
--      records who did so and when.
--
--   4. PAYSLIP BREAKDOWN. The salary components (Basic, HRA, PF, …) a detailed
--      slip was issued with, so next month's slip starts from them.
--
--   5. OFFER LETTER DELIVERY. When, and to whom, a letter was emailed.
--
-- Re-runnable: every statement is idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Meetings
-- ---------------------------------------------------------------------------

/**
 * Is the caller invited to a meeting with these attendees?
 *
 * Attendees are stored by EMAIL (they may be people with no account), so the
 * caller's address is read from their profile. SECURITY DEFINER so the lookup
 * does not itself depend on the profiles policies; it only ever answers for
 * `auth.uid()`.
 */
create or replace function app.is_meeting_attendee(p_attendees jsonb)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
      from public.profiles p,
           jsonb_array_elements(
             case when jsonb_typeof(p_attendees) = 'array' then p_attendees else '[]'::jsonb end
           ) a
     where p.id = auth.uid()
       and p.email is not null
       and lower(btrim(a ->> 'email')) = lower(btrim(p.email))
  );
$$;

revoke execute on function app.is_meeting_attendee(jsonb) from anon, public;
grant  execute on function app.is_meeting_attendee(jsonb) to authenticated, service_role;

drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select to authenticated
using (
  (select app.is_super_admin())
  or (
    tenant_id = (select app.current_tenant_id())
    and (select app.is_active_member())
    and (
      (select app.is_org())
      or organizer_id = (select auth.uid())
      or app.is_meeting_attendee(attendees)
    )
  )
);

-- ---------------------------------------------------------------------------
-- 2. Timesheet lines: the org edits only a week awaiting its decision
-- ---------------------------------------------------------------------------

/** Is this timesheet in the caller's workspace and awaiting review? */
create or replace function app.timesheet_under_review(p_timesheet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1 from public.timesheets t
     where t.id = p_timesheet_id
       and t.status = 'submitted'
       and t.tenant_id = app.current_tenant_id()
  );
$$;

revoke execute on function app.timesheet_under_review(uuid) from anon, public;
grant  execute on function app.timesheet_under_review(uuid) to authenticated, service_role;

drop policy if exists timesheet_entries_insert on public.timesheet_entries;
create policy timesheet_entries_insert on public.timesheet_entries for insert to authenticated
with check (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    ((select app.is_org()) and app.timesheet_under_review(timesheet_id))
    or app.timesheet_editable(timesheet_id)
  )
);

drop policy if exists timesheet_entries_update on public.timesheet_entries;
create policy timesheet_entries_update on public.timesheet_entries for update to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    ((select app.is_org()) and app.timesheet_under_review(timesheet_id))
    or app.timesheet_editable(timesheet_id)
  )
)
with check (
  tenant_id = (select app.current_tenant_id())
  and (
    ((select app.is_org()) and app.timesheet_under_review(timesheet_id))
    or app.timesheet_editable(timesheet_id)
  )
);

drop policy if exists timesheet_entries_delete on public.timesheet_entries;
create policy timesheet_entries_delete on public.timesheet_entries for delete to authenticated
using (
  tenant_id = (select app.current_tenant_id())
  and (select app.is_active_member())
  and (
    ((select app.is_org()) and app.timesheet_under_review(timesheet_id))
    or app.timesheet_editable(timesheet_id)
  )
);

-- ---------------------------------------------------------------------------
-- 3. Attendance corrections
-- ---------------------------------------------------------------------------

alter table public.attendance
  add column if not exists edited_by uuid references public.profiles(id) on delete set null,
  add column if not exists edited_at timestamptz;

comment on column public.attendance.edited_by is
  'The org user who last corrected this shift''s times (055). NULL = as clocked.';

-- ---------------------------------------------------------------------------
-- 4. Payslip breakdown
-- ---------------------------------------------------------------------------

alter table public.payslips
  add column if not exists details jsonb;

comment on column public.payslips.details is
  'Salary components of a detailed slip — earnings, deductions, PF no. (055). NULL for a simple slip.';

-- ---------------------------------------------------------------------------
-- 5. Letter delivery
-- ---------------------------------------------------------------------------

alter table public.generated_documents
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text;

comment on column public.generated_documents.sent_at is
  'When the letter was last emailed to its recipient from the app (055).';
