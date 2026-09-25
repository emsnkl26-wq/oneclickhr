import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import {
  CalendarWorkspace, type GoogleConnectionSummary, type Teammate,
} from '@/components/calendar/calendar-workspace'
import { loadCalendarEvents, loadMeetingById, loadUpcomingMeetings } from '@/lib/calendar-events'
import { parseAnchor, parseMode, visibleRange, todayInZone } from '@/lib/calendar-range'
import { isCalendarConfigured } from '@/lib/google-calendar'
import { getViewerTimezone } from '@/lib/viewer-timezone'

export const metadata: Metadata = { title: 'Calendar' }
export const dynamic = 'force-dynamic'

/**
 * Everything happening across the workspace, on one grid — and where meetings
 * are scheduled.
 *
 * The period comes from the URL and the events are fetched FOR THAT PERIOD, so
 * paging to another month is a real query rather than a filter over whatever
 * happened to be loaded first.
 *
 * Meetings synced from Google are already rows in `meetings` (the two-way sync
 * in src/lib/calendar-sync.ts keeps them there), so they appear here without
 * the grid knowing Google exists.
 *
 * Drawn in the VIEWER's timezone (src/lib/viewer-timezone.ts), so an admin in
 * New York and one in Hyderabad each see a meeting on their own day and clock.
 */
export default async function OrgCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; meeting?: string }>
}) {
  const ctx = await requireOrg()
  const params = await searchParams
  const supabase = await createSupabaseServerClient()

  const timezone = await getViewerTimezone(ctx.tenant.timezone)
  const anchor = parseAnchor(params.date, timezone)
  const mode = parseMode(params.view)
  const range = visibleRange(anchor, mode)

  /*
   * Explicit columns on `calendar_connections`: the encrypted token column is
   * not readable by the `authenticated` role at all, so `select('*')` there
   * would fail outright.
   */
  const [events, upcoming, focusMeeting, { data: connection }, { data: teammates }] =
    await Promise.all([
      loadCalendarEvents(supabase, range, { portal: 'org', timezone }),
      loadUpcomingMeetings(supabase),
      loadMeetingById(supabase, params.meeting),
      supabase.from('calendar_connections').select('status, google_email').maybeSingle(),
      // The attendee picker needs everyone who can actually be invited.
      supabase
        .from('profiles')
        .select('id, full_name, email, photo_url')
        .eq('is_active', true)
        .not('email', 'is', null)
        .order('full_name')
        .limit(1000),
    ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Meetings, leave, birthdays and deadlines across the workspace. Schedule a meeting from any day."
      />
      <CalendarWorkspace
        events={events}
        anchor={anchor}
        mode={mode}
        today={todayInZone(timezone)}
        timezone={timezone}
        workspaceTimezone={ctx.tenant.timezone}
        basePath="/org/calendar"
        canManage
        connection={(connection as GoogleConnectionSummary | null) ?? null}
        calendarConfigured={isCalendarConfigured()}
        teammates={(teammates ?? []) as Teammate[]}
        upcoming={upcoming}
        focusMeeting={focusMeeting}
      />
    </div>
  )
}
