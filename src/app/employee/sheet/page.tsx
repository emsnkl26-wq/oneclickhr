import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { HoursSheet, type SheetRow } from '@/components/timesheet/hours-sheet'
import { todayIn, weekStartSunday, addDays } from '@/lib/time'
import type { TimesheetStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Sheet' }
export const dynamic = 'force-dynamic'

/** Weeks shown when no range is set. Twelve is a quarter — the usual question. */
const DEFAULT_WEEKS = 12
const MAX_ROWS = 500

interface FlatEntry {
  id: string
  task_name: string | null
  billable: boolean
  hours_sun: number
  hours_mon: number
  hours_tue: number
  hours_wed: number
  hours_thu: number
  hours_fri: number
  hours_sat: number
  project: { id: string; code: string; name: string; client_name: string | null } | null
  timesheet: {
    id: string
    code: string
    week_start: string
    week_end: string
    status: TimesheetStatus
  } | null
}

/**
 * Every logged line, flattened into one spreadsheet.
 *
 * This is the view someone opens when a client asks "how many hours in March?"
 * — so it is deliberately a FLAT table rather than the weekly grid: one row per
 * project per week, seven day columns, a total and a status. That shape is also
 * what exports cleanly to CSV, which is most of what it is for.
 *
 * The range is applied by the DATABASE against `timesheets.week_start`, and it
 * defaults to the last twelve weeks. An unbounded default would fetch a full
 * employment history on every visit to answer a question about this quarter.
 */
export default async function EmployeeSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const isDate = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const thisWeek = weekStartSunday(todayIn(ctx.tenant.timezone))

  const from = isDate(params.from) ? params.from! : addDays(thisWeek, -7 * (DEFAULT_WEEKS - 1))
  const to = isDate(params.to) ? params.to! : addDays(thisWeek, 6)

  const { data } = await supabase
    .from('timesheet_entries')
    .select(
      'id, task_name, billable, hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat, project:projects(id, code, name, client_name), timesheet:timesheets!inner(id, code, week_start, week_end, status)'
    )
    .gte('timesheet.week_start', from)
    .lte('timesheet.week_start', to)
    .limit(MAX_ROWS)

  const rows: SheetRow[] = ((data ?? []) as unknown as FlatEntry[])
    .filter((entry) => entry.timesheet)
    .map((entry) => ({
      id: entry.id,
      timesheetId: entry.timesheet!.id,
      timesheetCode: entry.timesheet!.code,
      weekStart: entry.timesheet!.week_start,
      weekEnd: entry.timesheet!.week_end,
      status: entry.timesheet!.status,
      projectLabel: entry.project
        ? `${entry.project.code} · ${entry.project.name}`
        : entry.task_name || 'Task',
      clientName: entry.project?.client_name ?? null,
      taskName: entry.task_name,
      billable: entry.billable,
      hours: [
        Number(entry.hours_sun), Number(entry.hours_mon), Number(entry.hours_tue),
        Number(entry.hours_wed), Number(entry.hours_thu), Number(entry.hours_fri),
        Number(entry.hours_sat),
      ],
    }))
    // Newest week first, then by project, so a week reads as one block.
    .sort((a, b) =>
      a.weekStart === b.weekStart
        ? a.projectLabel.localeCompare(b.projectLabel)
        : b.weekStart.localeCompare(a.weekStart)
    )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sheet"
        description="Every hour you have logged, flattened into one table you can export."
      />
      <HoursSheet
        rows={rows}
        from={from}
        to={to}
        capped={rows.length >= MAX_ROWS}
        timesheetHref={(timesheetId) => `/employee/timesheets/${timesheetId}`}
      />
    </div>
  )
}
