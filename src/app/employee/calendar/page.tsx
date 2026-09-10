import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace'
import { loadCalendarEvents } from '@/lib/calendar-events'
import { parseAnchor, parseMode, visibleRange, todayInZone } from '@/lib/calendar-range'

export const metadata: Metadata = { title: 'Calendar' }
export const dynamic = 'force-dynamic'

/**
 * The employee's own calendar.
 *
 * SAME LOADER AS THE ORG VIEW, and deliberately no role check in it. Every
 * query runs on the caller's own client, so RLS is what narrows this to their
 * leave, their meetings and their tasks — the policies decide, not a branch
 * somebody could forget to write. Birthdays are workspace-wide because the same
 * policy that powers the employee directory says so.
 *
 * The period comes from the URL and the events are fetched FOR THAT PERIOD, so
 * paging to another month is a real query rather than a filter over whatever
 * happened to be loaded first.
 */
export default async function EmployeeCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>
}) {
  const ctx = await requireEmployee()
  const params = await searchParams
  const supabase = await createSupabaseServerClient()

  const timezone = ctx.tenant.timezone
  const anchor = parseAnchor(params.date, timezone)
  const mode = parseMode(params.view)
  const range = visibleRange(anchor, mode)

  const events = await loadCalendarEvents(supabase, range, { portal: 'employee' })

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
        basePath="/employee/calendar"
      />
    </div>
  )
}
