import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace'
import { loadCalendarEvents } from '@/lib/calendar-events'
import { parseAnchor, parseMode, visibleRange, todayInZone } from '@/lib/calendar-range'

export const metadata: Metadata = { title: 'Calendar' }
export const dynamic = 'force-dynamic'

/**
 * Everything happening across the workspace, on one grid.
 *
 * The period comes from the URL and the events are fetched FOR THAT PERIOD, so
 * paging to another month is a real query rather than a filter over whatever
 * happened to be loaded first.
 *
 * Meetings synced from Google are already rows in `meetings` (the two-way sync
 * in src/lib/calendar-sync.ts keeps them there), so they appear here without
 * this page knowing Google exists.
 */
export default async function OrgCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>
}) {
  const ctx = await requireOrg()
  const params = await searchParams
  const supabase = await createSupabaseServerClient()

  const timezone = ctx.tenant.timezone
  const anchor = parseAnchor(params.date, timezone)
  const mode = parseMode(params.view)
  const range = visibleRange(anchor, mode)

  const events = await loadCalendarEvents(supabase, range, { portal: 'org' })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Meetings, leave, birthdays and deadlines across the workspace."
      />
      <CalendarWorkspace
        events={events}
        anchor={anchor}
        mode={mode}
        today={todayInZone(timezone)}
        timezone={timezone}
        basePath="/org/calendar"
      />
    </div>
  )
}
