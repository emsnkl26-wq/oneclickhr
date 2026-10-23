import { Suspense } from 'react'
import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, LoadError, TableCardSkeleton } from '@/components/ui/patterns'
import { LinkTabs } from '@/components/ui/link-tabs'
import { HoursSheet, type SheetRow } from '@/components/timesheet/hours-sheet'
import { TimesheetQueue, type QueueRow, type QueueTotals } from './timesheet-queue'
import { todayIn, weekStartSunday, addDays, hoursInRange, weekWithinRange } from '@/lib/time'
import type { TimesheetStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Timesheets' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const FILTERS = ['submitted', 'approved', 'rejected', 'all'] as const
type Filter = (typeof FILTERS)[number]

/** Weeks the sheet view covers when no range is set. Twelve is a quarter. */
const DEFAULT_WEEKS = 12
/**
 * ...plus weeks AHEAD of the current one. Timesheets are routinely filled for
 * the running week or the next, and a window that stopped at this Saturday hid
 * exactly those newest lines — the sheet read as empty until a range was typed.
 */
const DEFAULT_WEEKS_AHEAD = 4
const MAX_SHEET_ROWS = 500
/** Timesheets summed for the queue's totals; past this they are a floor. */
const MAX_TOTAL_ROWS = 5000

interface TimesheetWithEmployee {
  id: string
  code: string
  employee_id: string
  week_start: string
  week_end: string
  status: TimesheetStatus
  total_hours: number
  billable_hours: number
  overtime_hours: number | null
  weekly_learnings: string | null
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

  /*
   * The frame is free; the data is not.
   *
   * Heading and view tabs come from the URL alone, so they are in the first
   * flush of HTML and the tabs are clickable while the rows are still being
   * read. That matters most on the two slowest paths this page has: the sheet
   * view reads up to five hundred timesheet LINES across a quarter, and the
   * queue totals sum up to five thousand rows to answer "approved, March,
   * Priya". Both used to hold the heading and the tabs behind them.
   *
   * The boundary is keyed on everything that changes the result set, so moving
   * between tabs, pages or date ranges shows a skeleton rather than leaving the
   * previous view's rows on screen looking like the answer to the new question.
   */
  const boundaryKey = `${view}:${params.status ?? ''}:${params.q ?? ''}:${params.page ?? ''}:${from}:${to}`

  return (
    <div className="space-y-6">
      {header}
      {view === 'sheet' ? (
        <Suspense key={boundaryKey} fallback={<TableCardSkeleton columns={9} rows={10} />}>
          <SheetView ctx={ctx} from={from} to={to} />
        </Suspense>
      ) : (
        <Suspense key={boundaryKey} fallback={<TableCardSkeleton columns={7} rows={10} />}>
          <QueueView ctx={ctx} params={params} from={from} to={to} />
        </Suspense>
      )}
    </div>
  )
}

/* ------------------------------------------------------- Streamed regions */

/**
 * SHEET — one row per project per week, seven day columns, for reconciling and
 * exporting. The same component the employee's own Sheet page uses, so both
 * sides of an invoice conversation are reading identical numbers.
 */
async function SheetView({
  ctx,
  from,
  to,
}: {
  ctx: Awaited<ReturnType<typeof requireOrg>>
  from: string
  to: string
}) {
  const supabase = await createSupabaseServerClient()
  const thisWeek = weekStartSunday(todayIn(ctx.tenant.timezone))
  const rangeFrom = from || addDays(thisWeek, -7 * (DEFAULT_WEEKS - 1))
  const rangeTo = to || addDays(thisWeek, 7 * DEFAULT_WEEKS_AHEAD + 6)

  const { data, error: sheetError } = await supabase
    .from('timesheet_entries')
    .select(
      'id, task_name, billable, hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat, project:projects(id, code, name, client_name), timesheet:timesheets!inner(id, code, week_start, week_end, status, employee:profiles!timesheets_employee_id_fkey(full_name, email))'
    )
    // Weeks that OVERLAP the range, not only those that start inside it: a week
    // straddling the start of the range (it began the previous Sunday) still has
    // days the report asked for, and the sheet prorates each row to those days.
    .gte('timesheet.week_end', rangeFrom)
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

  if (sheetError) console.error('[org/timesheets sheet view] load failed', sheetError)

  return (
    <>
      {sheetError ? <LoadError what="The hours sheet" /> : null}
      <HoursSheet
        rows={rows}
        from={rangeFrom}
        to={rangeTo}
        capped={rows.length >= MAX_SHEET_ROWS}
        showEmployee
        timesheetBasePath="/org/timesheets"
      />
    </>
  )
}

/**
 * QUEUE — one row per timesheet, for deciding. Filtered, searched and paged by
 * the database, with the employee's name as an EMBEDDED join rather than a
 * follow-up `.in('id', …)` that could not start until this query returned.
 */
async function QueueView({
  ctx,
  params,
  from,
  to,
}: {
  ctx: Awaited<ReturnType<typeof requireOrg>>
  params: { status?: string; q?: string; page?: string }
  from: string
  to: string
}) {
  const supabase = await createSupabaseServerClient()

  const filter: Filter = FILTERS.includes(params.status as Filter)
    ? (params.status as Filter)
    : 'submitted'
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = supabase
    .from('timesheets')
    .select(
      'id, code, employee_id, week_start, week_end, status, total_hours, billable_hours, overtime_hours, weekly_learnings, review_note, attachment_name, submitted_at, employee:profiles!timesheets_employee_id_fkey!inner(full_name, email, photo_url)',
      { count: 'exact' }
    )
    .order('week_start', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (filter !== 'all') query = query.eq('status', filter)
  // `!inner` on the embed is what lets this filter PARENT rows by the employee's
  // name; without it the filter would prune only the embedded object and leave
  // the timesheet behind with nobody attached to it.
  if (search) query = query.ilike('employee.full_name', `%${search}%`)
  // Weeks that OVERLAP [from, to], so a week clipped by the range still appears
  // and its in-range hours are counted — `week_start >= from AND week_end <= to`
  // would show only weeks falling entirely inside and drop the edges.
  if (from) query = query.gte('week_end', from)
  if (to) query = query.lte('week_start', to)

  // The pending badge has to survive the other tabs, so it is its own count.
  const [{ data, count }, pending, totals] = await Promise.all([
    query,
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    loadQueueTotals(supabase, { filter, search, from, to }),
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
    overtimeHours: Number(sheet.overtime_hours ?? 0),
    weeklyLearnings: sheet.weekly_learnings,
    reviewNote: sheet.review_note,
    hasAttachment: !!sheet.attachment_name,
  }))

  return (
    <TimesheetQueue
      timesheets={rows}
      total={count ?? rows.length}
      page={page}
      perPage={PER_PAGE}
      filter={filter}
      pendingCount={pending.count ?? 0}
      totals={totals}
      searching={!!search || !!from || !!to}
      from={from}
      to={to}
      timezone={ctx.tenant.timezone}
    />
  )
}

/**
 * The three figures on the queue's stat cards — summed across EVERY timesheet
 * the filters match, not just the page on screen.
 *
 * TWO PATHS, because a week is stored as one indivisible Sunday→Saturday block
 * but a date range asks for exact days:
 *
 *   NO RANGE — the whole-week aggregates on the timesheet row are exactly right
 *     and cheap: three numbers per week, no entry rows read.
 *   A RANGE  — the aggregates would over-count (a week straddling the edge drags
 *     its outside days in) or under-count (a clipped week dropped entirely), so
 *     the hours are re-summed from the day cells, counting only the days inside
 *     [from, to]. Overtime stays a whole-week figure: it counts only for weeks
 *     that fall entirely within the range, never prorated across a clipped one.
 */
async function loadQueueTotals(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  { filter, search, from, to }: { filter: Filter; search: string; from: string; to: string }
): Promise<QueueTotals> {
  const round2 = (n: number) => Math.round(n * 100) / 100

  if (!from && !to) {
    let q = supabase
      .from('timesheets')
      .select('total_hours, billable_hours, overtime_hours, employee:profiles!timesheets_employee_id_fkey!inner(full_name)')
      .limit(MAX_TOTAL_ROWS)
    if (filter !== 'all') q = q.eq('status', filter)
    if (search) q = q.ilike('employee.full_name', `%${search}%`)
    const { data } = await q
    const rows = (data ?? []) as unknown as Array<{
      total_hours: number | string | null
      billable_hours: number | string | null
      overtime_hours: number | string | null
    }>
    const sum = (key: 'total_hours' | 'billable_hours' | 'overtime_hours') =>
      round2(rows.reduce((acc, row) => acc + Number(row[key] ?? 0), 0))
    return {
      total: sum('total_hours'),
      billable: sum('billable_hours'),
      overtime: sum('overtime_hours'),
      capped: rows.length >= MAX_TOTAL_ROWS,
    }
  }

  // The weeks that OVERLAP the range, with the week bounds we need to clip each
  // one and the whole-week overtime figure.
  let wq = supabase
    .from('timesheets')
    .select('id, week_start, week_end, overtime_hours, employee:profiles!timesheets_employee_id_fkey!inner(full_name)')
    .limit(MAX_TOTAL_ROWS)
  if (filter !== 'all') wq = wq.eq('status', filter)
  if (search) wq = wq.ilike('employee.full_name', `%${search}%`)
  if (from) wq = wq.gte('week_end', from)
  if (to) wq = wq.lte('week_start', to)
  const { data: weekData } = await wq
  const weeks = (weekData ?? []) as Array<{
    id: string
    week_start: string
    week_end: string
    overtime_hours: number | string | null
  }>

  const overtime = round2(
    weeks.reduce(
      (acc, w) =>
        acc + (weekWithinRange(w.week_start, w.week_end, from, to) ? Number(w.overtime_hours ?? 0) : 0),
      0
    )
  )

  const weekStartById = new Map(weeks.map((w) => [w.id, w.week_start]))
  const ids = weeks.map((w) => w.id)

  let total = 0
  let billable = 0
  // Chunked so even a years-wide range cannot pack thousands of ids into one URL.
  for (let i = 0; i < ids.length; i += 200) {
    const { data: entryData } = await supabase
      .from('timesheet_entries')
      .select('timesheet_id, billable, hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat')
      .in('timesheet_id', ids.slice(i, i + 200))
    for (const e of (entryData ?? []) as Array<{
      timesheet_id: string
      billable: boolean
      hours_sun: number | string; hours_mon: number | string; hours_tue: number | string
      hours_wed: number | string; hours_thu: number | string; hours_fri: number | string
      hours_sat: number | string
    }>) {
      const ws = weekStartById.get(e.timesheet_id)
      if (!ws) continue
      const inRange = hoursInRange(
        ws,
        [e.hours_sun, e.hours_mon, e.hours_tue, e.hours_wed, e.hours_thu, e.hours_fri, e.hours_sat].map(Number),
        from,
        to
      )
      total += inRange
      if (e.billable) billable += inRange
    }
  }

  return {
    total: round2(total),
    billable: round2(billable),
    overtime,
    capped: weeks.length >= MAX_TOTAL_ROWS,
  }
}
