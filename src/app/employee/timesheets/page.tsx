import type { Metadata } from 'next'
import { Timer, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatCard } from '@/components/ui/patterns'
import { TimesheetList, type TimesheetRow } from './timesheet-list'
import { todayIn, weekStartSunday } from '@/lib/time'

export const metadata: Metadata = { title: 'Timesheets' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 25

/**
 * The employee's own timesheets, newest week first.
 *
 * The four counts are separate `head: true` queries rather than a tally of the
 * rows on screen. The list is one page of twenty-five, so counting it would cap
 * every card at twenty-five — a person with sixty approved weeks would be told
 * they had twenty-five.
 */
export default async function EmployeeTimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  const [sheets, total, approved, rejected, submitted] = await Promise.all([
    supabase
      .from('timesheets')
      .select(
        'id, code, week_start, week_end, status, total_hours, billable_hours, comments, attachment_name, review_note, submitted_at, created_at',
        { count: 'exact' }
      )
      .order('week_start', { ascending: false })
      .range(offset, offset + PER_PAGE - 1),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
  ])

  const rows = (sheets.data ?? []) as unknown as TimesheetRow[]

  /*
   * A failed query and an empty workspace are NOT the same screen.
   *
   * `sheets.data ?? []` renders "No timesheets yet" for both, and that sentence
   * is a lie in the first case: it tells someone their week is gone when the
   * rows are sitting in the database. They then open the week again, find it
   * empty, and file the same hours twice.
   */
  if (sheets.error) {
    console.error('[employee/timesheets] list query failed', sheets.error)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timesheets"
        description="Log your hours a week at a time and send them for approval."
      />

      {sheets.error ? (
        <div
          role="alert"
          className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-3.5 text-sm text-danger"
        >
          Your timesheets could not be loaded just now. Nothing has been lost — please reload the
          page, and contact your administrator if it keeps happening.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Timesheets" value={total.count ?? 0} icon={Timer} tone="pink" accent />
        <StatCard label="Approved" value={approved.count ?? 0} icon={CheckCircle2} tone="purple" />
        <StatCard label="Rejected" value={rejected.count ?? 0} icon={XCircle} tone="indigo" />
        <StatCard
          label="Awaiting review"
          value={submitted.count ?? 0}
          icon={Clock}
          tone="orange"
          hint={submitted.count ? 'With your organization' : 'Nothing pending'}
        />
      </div>

      <TimesheetList
        timesheets={rows}
        total={sheets.count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        currentWeek={weekStartSunday(todayIn(ctx.tenant.timezone))}
      />
    </div>
  )
}
