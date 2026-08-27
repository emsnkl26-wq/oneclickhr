import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Users, Timer, CalendarRange } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { projectHourTotals } from '@/lib/projects'
import { PageHeader, StatCard, StatusChip, EmptyState } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { formatDateLabel, formatPeriod } from '@/lib/time'
import { initials, formatHours } from '@/lib/utils'
import type { ProjectStatus, TimesheetStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Project' }
export const dynamic = 'force-dynamic'

/** A timesheet line against this project, with the week and person it belongs to. */
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
    employee: { id: string; full_name: string | null; email: string | null } | null
  } | null
}

const entryHours = (entry: EntryRow) =>
  Number(entry.hours_sun) + Number(entry.hours_mon) + Number(entry.hours_tue) +
  Number(entry.hours_wed) + Number(entry.hours_thu) + Number(entry.hours_fri) +
  Number(entry.hours_sat)

/**
 * Everything logged against one project.
 *
 * `!inner` on the timesheet embed matters: without it a line whose parent sheet
 * was filtered out would still come back, carrying a null timesheet and no week
 * to file it under.
 */
export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireOrg()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  // RLS scopes this to the tenant, so an id from another workspace is a 404.
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select(
      'id, code, name, client_name, end_client_name, description, start_date, end_date, status, assignments:project_assignments(employee:profiles(id, full_name, email, photo_url, designation))'
    )
    .eq('id', id)
    .maybeSingle()

  // A read that FAILED is not a record that is missing. Answering both with
  // notFound() tells someone it was deleted when the database was simply
  // unreachable, which is the one explanation they cannot act on.
  if (projectError) {
    console.error('[org/projects/:id] load failed', projectError)
    throw new Error('That project could not be loaded. Please try again.')
  }

  if (!project) notFound()

  const [{ data: entries }, totals] = await Promise.all([
    supabase
      .from('timesheet_entries')
      .select(
        'id, task_name, billable, hours_sun, hours_mon, hours_tue, hours_wed, hours_thu, hours_fri, hours_sat, timesheet:timesheets!inner(id, code, week_start, week_end, status, employee:profiles!timesheets_employee_id_fkey(id, full_name, email))'
      )
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
    projectHourTotals(supabase, id),
  ])

  const rows = (entries ?? []) as unknown as EntryRow[]
  const approvedHours = totals.get(id) ?? 0
  const pendingHours = rows
    .filter((row) => row.timesheet?.status === 'submitted')
    .reduce((sum, row) => sum + entryHours(row), 0)

  const members = (
    project.assignments as unknown as Array<{
      employee: {
        id: string
        full_name: string | null
        email: string | null
        photo_url: string | null
        designation: string | null
      } | null
    }>
  )
    .map((assignment) => assignment.employee)
    .filter(Boolean) as Array<{
    id: string
    full_name: string | null
    email: string | null
    photo_url: string | null
    designation: string | null
  }>

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.name}
        description={`${project.code}${project.client_name ? ` · ${project.client_name}` : ''}`}
        actions={
          <Button asChild variant="secondary">
            <Link href="/org/projects">
              <ArrowLeft />
              All projects
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
          label="Approved hours"
          value={approvedHours ? formatHours(approvedHours) : '0h'}
          icon={Timer}
          accent
          hint="Counted from approved timesheets only"
        />
        <StatCard
          label="Awaiting approval"
          value={pendingHours ? formatHours(pendingHours) : '—'}
          icon={CalendarRange}
          tone="orange"
        />
        <StatCard label="Assigned employees" value={members.length} icon={Users} tone="indigo" />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <CardTitle>Timesheet lines</CardTitle>
          </CardHeader>
          {rows.length === 0 ? (
            <EmptyState
              icon={Timer}
              title="No hours logged yet"
              description="Lines your team files against this project will appear here."
            />
          ) : (
            <div className="scrollbar-thin max-h-[560px] overflow-y-auto">
              <ul className="divide-y divide-line">
                {rows.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {entry.timesheet?.employee?.full_name ||
                          entry.timesheet?.employee?.email ||
                          'Employee'}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {entry.timesheet
                          ? `${entry.timesheet.code} · ${formatPeriod(
                              entry.timesheet.week_start,
                              entry.timesheet.week_end
                            )}`
                          : '—'}
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
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Team</CardTitle>
          </CardHeader>
          {members.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nobody assigned"
              description="Assign people from the projects list so they can log hours."
            />
          ) : (
            <ul className="divide-y divide-line">
              {members.map((person) => (
                <li key={person.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar>
                    {person.photo_url ? (
                      <AvatarImage
                        src={`/api/files/view?key=${encodeURIComponent(person.photo_url)}`}
                        alt=""
                      />
                    ) : null}
                    <AvatarFallback>{initials(person.full_name, person.email)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/org/employees/${person.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {person.full_name || person.email}
                    </Link>
                    <p className="truncate text-xs text-ink-muted">
                      {person.designation || 'No designation'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
