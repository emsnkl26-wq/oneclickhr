import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { LinkTabs } from '@/components/ui/link-tabs'
import { HoursSheet, type SheetRow } from '@/components/timesheet/hours-sheet'
import { TimesheetQueue, type QueueRow } from './timesheet-queue'
import { todayIn, weekStartSunday, addDays } from '@/lib/time'
import type { TimesheetStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Timesheets' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const FILTERS = ['submitted', 'approved', 'rejected', 'all'] as const
type Filter = (typeof FILTERS)[number]

/** Weeks the sheet view covers when no range is set. Twelve is a quarter. */
const DEFAULT_WEEKS = 12
const MAX_SHEET_ROWS = 500

interface TimesheetWithEmployee {
  id: string
  code: string
  employee_id: string
  week_start: string
  week_end: string
  status: TimesheetStatus
  total_hours: number
  billable_hours: number
  comments: string | null
  review_note: string | null
  attachment_name: string | null
  submitted_at: string | null
  employee: { full_name: string | null; email: string | null; photo_url: string | null } | null
}

/** One flattened line, as the sheet view reads it. */
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
    employee: { full_name: string | null; email: string | null } | null
  } | null
}

const isDate = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * Two views of the same data, chosen by `?view=`.
 *
 *   QUEUE — one row per timesheet, for deciding. Filtered, searched and paged by
 *     the database, with the employee's name as an EMBEDDED join rather than a
 *     follow-up `.in('id', …)` that could not start until this query returned.
 *   SHEET — one row per project per week, seven day columns, for reconciling and
 *     exporting. The same component the employee's own Sheet page uses, so both
 *     sides of an invoice conversation are reading identical numbers.
 *
 * Only the open view is fetched. Loading both would make every visit pay for the
 * one nobody asked for, which on the sheet side means every timesheet LINE in the
 * workspace.
 */
export default async function OrgTimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    q?: string
    page?: string
    from?: string
    to?: string
    view?: string
  }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const view: 'queue' | 'sheet' = params.view === 'sheet' ? 'sheet' : 'queue'
  const from = isDate(params.from) ? params.from! : ''
  const to = isDate(params.to) ? params.to! : ''

  const header = (
    <>
      <PageHeader
        title="Timesheets"
        description="Review and approve the hours your team has submitted."
      />
      <LinkTabs
        param="view"
        active={view}
        resets={['page']}
        tabs={[
          { value: 'queue', label: 'Approval queue' },
          { value: 'sheet', label: 'Hours sheet' },
        ]}
      />
    </>
  )

  if (view === 'sheet') {
    const thisWeek = weekStartSunday(todayIn(ctx.tenant.timezone))
    const rangeFrom = from || addDays(thisWeek, -7 * (DEFAULT_WEEKS - 1))
    const rangeTo = to || addDays(thisWeek, 6)

    const { data } = await supabase
      .from('timesheet_entries')
      .select(
        'id, task_name, billable, hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat, project:projects(id, code, name, client_name), timesheet:timesheets!inner(id, code, week_start, week_end, status, employee:profiles!timesheets_employee_id_fkey(full_name, email))'
      )
      .gte('timesheet.week_start', rangeFrom)
      .lte('timesheet.week_start', rangeTo)
      .limit(MAX_SHEET_ROWS)

    const rows: SheetRow[] = ((data ?? []) as unknown as FlatEntry[])
      .filter((entry) => entry.timesheet)
      .map((entry) => ({
        id: entry.id,
        timesheetId: entry.timesheet!.id,
        timesheetCode: entry.timesheet!.code,
        weekStart: entry.timesheet!.week_start,
        weekEnd: entry.timesheet!.week_end,
        status: entry.timesheet!.status,
        employeeName:
          entry.timesheet!.employee?.full_name || entry.timesheet!.employee?.email || 'Employee',
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
      // Newest week first, then by employee, so a week reads as one block.
      .sort((a, b) =>
        a.weekStart === b.weekStart
          ? (a.employeeName ?? '').localeCompare(b.employeeName ?? '')
          : b.weekStart.localeCompare(a.weekStart)
      )

    return (
      <div className="space-y-6">
        {header}
        <HoursSheet
          rows={rows}
          from={rangeFrom}
          to={rangeTo}
          capped={rows.length >= MAX_SHEET_ROWS}
          showEmployee
          timesheetBasePath="/org/timesheets"
        />
      </div>
    )
  }

  const filter: Filter = FILTERS.includes(params.status as Filter)
    ? (params.status as Filter)
    : 'submitted'
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = supabase
    .from('timesheets')
    .select(
      'id, code, employee_id, week_start, week_end, status, total_hours, billable_hours, comments, review_note, attachment_name, submitted_at, employee:profiles!timesheets_employee_id_fkey!inner(full_name, email, photo_url)',
      { count: 'exact' }
    )
    .order('week_start', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (filter !== 'all') query = query.eq('status', filter)
  // `!inner` on the embed is what lets this filter PARENT rows by the employee's
  // name; without it the filter would prune only the embedded object and leave
  // the timesheet behind with nobody attached to it.
  if (search) query = query.ilike('employee.full_name', `%${search}%`)
  if (from) query = query.gte('week_start', from)
  if (to) query = query.lte('week_end', to)

  // The pending badge has to survive the other tabs, so it is its own count.
  const [{ data, count }, pending] = await Promise.all([
    query,
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
  ])

  const rows: QueueRow[] = ((data ?? []) as unknown as TimesheetWithEmployee[]).map((sheet) => ({
    id: sheet.id,
    code: sheet.code,
    employeeId: sheet.employee_id,
    employeeName: sheet.employee?.full_name || sheet.employee?.email || 'Employee',
    employeePhoto: sheet.employee?.photo_url ?? null,
    weekStart: sheet.week_start,
    weekEnd: sheet.week_end,
    status: sheet.status,
    totalHours: Number(sheet.total_hours),
    billableHours: Number(sheet.billable_hours),
    comments: sheet.comments,
    reviewNote: sheet.review_note,
    hasAttachment: !!sheet.attachment_name,
  }))

  return (
    <div className="space-y-6">
      {header}
      <TimesheetQueue
        timesheets={rows}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filter={filter}
        pendingCount={pending.count ?? 0}
        searching={!!search || !!from || !!to}
        from={from}
        to={to}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
