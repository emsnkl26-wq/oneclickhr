import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Timer, CalendarRange, Users } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { projectHourTotals } from '@/lib/projects'
import { PageHeader, StatCard, StatusChip, EmptyState } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatDateLabel, formatPeriod } from '@/lib/time'
import { formatHours } from '@/lib/utils'
import type { ProjectStatus, TimesheetStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Project' }
export const dynamic = 'force-dynamic'

interface EntryRow {
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
  timesheet: {
    id: string
    code: string
    week_start: string
    week_end: string
    status: TimesheetStatus
  } | null
}

const entryHours = (entry: EntryRow) =>
  Number(entry.hours_sun) + Number(entry.hours_mon) + Number(entry.hours_tue) +
  Number(entry.hours_wed) + Number(entry.hours_thu) + Number(entry.hours_fri) +
  Number(entry.hours_sat)

/**
 * One project, from this employee's side.
 *
 * Every query runs through the user-scoped client, so the `timesheet_entries`
 * policy limits the lines to sheets this person owns — there is no filter here
 * that could be forgotten and no way to read a colleague's hours on the same
 * project.
 */
export default async function EmployeeProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireEmployee()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  // The `projects_select` policy requires membership for an employee, so a
  // project this person is not on is a 404 rather than a permission error.
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, code, name, client_name, end_client_name, description, start_date, end_date, status')
    .eq('id', id)
    .maybeSingle()

  // A read that FAILED is not a record that is missing. Answering both with
  // notFound() tells someone it was deleted when the database was simply
  // unreachable, which is the one explanation they cannot act on.
  if (projectError) {
    console.error('[employee/projects/:id] load failed', projectError)
    throw new Error('That project could not be loaded. Please try again.')
  }

  if (!project) notFound()

  const [{ data: entries }, totals, { count: teamSize }] = await Promise.all([
    supabase
      .from('timesheet_entries')
      .select(
        'id, task_name, billable, hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat, timesheet:timesheets!inner(id, code, week_start, week_end, status)'
      )
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
    projectHourTotals(supabase, id),
    supabase
      .from('project_assignments')
      .select('employee_id', { count: 'exact', head: true })
      .eq('project_id', id),
  ])

  const rows = (entries ?? []) as unknown as EntryRow[]
  const approvedHours = totals.get(id) ?? 0
  const pendingHours = rows
    .filter((row) => row.timesheet?.status === 'submitted')
    .reduce((sum, row) => sum + entryHours(row), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        description={`${project.code}${project.client_name ? ` · ${project.client_name}` : ''}`}
        actions={
          <Button asChild variant="secondary">
            <Link href="/employee/projects">
              <ArrowLeft />
              My projects
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-start gap-x-10 gap-y-4 rounded-xl border border-line bg-card p-5 shadow-sm">
        {[
          ['Project ID', project.code],
          ['Client', project.client_name || '—'],
          ['End client', project.end_client_name || '—'],
          ['Start date', formatDateLabel(project.start_date)],
          ['End date', formatDateLabel(project.end_date)],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</p>
            <p className="tabular mt-0.5 text-sm font-medium">{value}</p>
          </div>
        ))}
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">Status</p>
          <div className="mt-1">
            <StatusChip status={project.status as ProjectStatus} />
          </div>
        </div>
      </div>

      {project.description ? (
        <Card>
          <CardContent className="text-sm leading-relaxed text-ink-muted">
            {project.description}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="My approved hours"
          value={approvedHours ? formatHours(approvedHours) : '0h'}
          icon={Timer}
          accent
        />
        <StatCard
          label="Awaiting approval"
          value={pendingHours ? formatHours(pendingHours) : '—'}
          icon={CalendarRange}
          tone="orange"
        />
        <StatCard label="People on this project" value={teamSize ?? 0} icon={Users} tone="indigo" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My timesheet history</CardTitle>
        </CardHeader>
        {rows.length === 0 ? (
          <EmptyState
            icon={Timer}
            title="No hours logged yet"
            description="Open a timesheet and add a line for this project."
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {entry.timesheet
                      ? formatPeriod(entry.timesheet.week_start, entry.timesheet.week_end)
                      : '—'}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {entry.timesheet?.code}
                    {entry.task_name ? ` · ${entry.task_name}` : ''}
                  </p>
                </div>
                {!entry.billable ? (
                  <StatusChip status="neutral" tone="neutral" label="Non-billable" />
                ) : null}
                {entry.timesheet ? <StatusChip status={entry.timesheet.status} /> : null}
                <span className="tabular w-16 shrink-0 text-right text-sm font-medium">
                  {formatHours(entryHours(entry))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
