import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace'
import { loadCalendarEvents, loadMeetingById, loadUpcomingMeetings } from '@/lib/calendar-events'
import { parseAnchor, parseMode, visibleRange, todayInZone } from '@/lib/calendar-range'
import { getViewerTimezone } from '@/lib/viewer-timezone'

export const metadata: Metadata = { title: 'Calendar' }
export const dynamic = 'force-dynamic'

/**
 * The employee's own calendar, and their meetings.
 *
 * SAME LOADER AS THE ORG VIEW, and deliberately no role check in it. Every
 * query runs on the caller's own client, so RLS is what narrows this to their
 * leave, their meetings and their tasks — the policies decide, not a branch
 * somebody could forget to write. Employees have no write policy on
 * `meetings`, so this page reads: a meeting opens its details and Join link.
 */
export default async function EmployeeCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; meeting?: string }>
}) {
  const ctx = await requireEmployee()
  const params = await searchParams
  const supabase = await createSupabaseServerClient()

  const timezone = await getViewerTimezone(ctx.tenant.timezone)
  const anchor = parseAnchor(params.date, timezone)
  const mode = parseMode(params.view)
  const range = visibleRange(anchor, mode)

  const [events, upcoming, focusMeeting] = await Promise.all([
    loadCalendarEvents(supabase, range, { portal: 'employee', timezone }),
    loadUpcomingMeetings(supabase),
    loadMeetingById(supabase, params.meeting),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Your meetings, leave, tasks and the team's birthdays."
      />
      <CalendarWorkspace
        events={events}
        anchor={anchor}
        mode={mode}
        today={todayInZone(timezone)}
        timezone={timezone}
        workspaceTimezone={ctx.tenant.timezone}
        basePath="/employee/calendar"
        upcoming={upcoming}
        focusMeeting={focusMeeting}
      />
    </div>
  )
}
