import type { Metadata } from 'next'
import Link from 'next/link'
import {
  CalendarCheck, Clock, TimerReset, ArrowRight, Bell, ClipboardList,
  Briefcase, Timer, CheckCircle2, XCircle,
} from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard, PageHeader, EmptyState, StatusChip } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { formatLocal, todayIn } from '@/lib/time'
import { formatHours } from '@/lib/utils'
import { ShiftToggle } from './shift-toggle'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

export default async function EmployeeDashboard() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()
  const tz = ctx.tenant.timezone
  const today = todayIn(tz)
  const monthStart = `${today.slice(0, 7)}-01`

  /*
   * Every query here is scoped to this employee BY RLS, not by the filters
   * below. The `.eq('employee_id', ...)` on some of them is redundant — the
   * attendance/leaves policies already restrict an employee to `employee_id =
   * auth.uid()`. It stays because it makes the intent legible at the call site.
   */
  const [
    todayRecord,
    monthRecords,
    pendingLeaves,
    notifications,
    myTasks,
    activeProjects,
    timesheetCount,
    approvedCount,
    rejectedCount,
  ] = await Promise.all([
    supabase
      .from('attendance')
      .select('id, login_time, logout_time, total_hours, is_late')
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('attendance')
      .select('id, date, login_time, logout_time, total_hours, is_late')
      .gte('date', monthStart)
      .order('date', { ascending: false }),
    supabase
      .from('leaves')
      .select('id, start_date, end_date, days, status')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('notifications')
      .select('id, title, description, created_at')
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('task_assignees')
      .select('task_id, tasks(id, title, priority, due_date)')
      .eq('profile_id', ctx.userId)
      .limit(5),
    /*
     * The four cards below read `count` with `head: true` — an index-only scan
     * that returns no rows at all. Fetching the timesheets to count them would
     * pull an employment history's worth of weeks onto a dashboard that only
     * ever shows the number.
     */
    supabase
      .from('project_assignments')
      .select('project_id, projects!inner(status)', { count: 'exact', head: true })
      .eq('projects.status', 'active'),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('timesheets').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
  ])

  const records = monthRecords.data ?? []
  const totalHours = records.reduce((sum, r) => sum + Number(r.total_hours ?? 0), 0)
  const lateCount = records.filter((r) => r.is_late).length
  const current = todayRecord.data

  const tasks = (myTasks.data ?? [])
    .map((row) => row.tasks as unknown as { id: string; title: string; priority: string; due_date: string | null } | null)
    .filter(Boolean) as Array<{ id: string; title: string; priority: string; due_date: string | null }>

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello${ctx.fullName ? `, ${ctx.fullName.split(' ')[0]}` : ''}`}
        description={formatLocal(new Date(), tz, 'EEEE, d MMMM yyyy')}
      />

      <ShiftToggle
        initialState={
          current
            ? {
                clockedIn: !current.logout_time,
                loginTime: current.login_time,
                logoutTime: current.logout_time,
                totalHours: current.total_hours,
                isLate: current.is_late,
              }
            : { clockedIn: false, loginTime: null, logoutTime: null, totalHours: null, isLate: false }
        }
        timezone={tz}
        shiftStart={ctx.tenant.workStartTime}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Days present this month"
          value={records.length}
          icon={CalendarCheck}
          accent
          href="/employee/attendance"
        />
        <StatCard label="Hours this month" value={formatHours(totalHours)} icon={Clock} />
        <StatCard
          label="Late logins"
          value={lateCount}
          icon={TimerReset}
          hint={`Shift starts at ${ctx.tenant.workStartTime}`}
        />
        <StatCard
          label="Projects"
          value={activeProjects.count ?? 0}
          icon={Briefcase}
          tone="orange"
          href="/employee/projects"
          hint="Active assignments"
        />
        <StatCard
          label="Timesheets"
          value={timesheetCount.count ?? 0}
          icon={Timer}
          tone="pink"
          href="/employee/timesheets"
        />
        <StatCard
          label="Approved"
          value={approvedCount.count ?? 0}
          icon={CheckCircle2}
          tone="purple"
          href="/employee/timesheets"
        />
        <StatCard
          label="Rejected"
          value={rejectedCount.count ?? 0}
          icon={XCircle}
          tone="indigo"
          href="/employee/timesheets"
          hint={rejectedCount.count ? 'Needs your attention' : 'Nothing returned'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent attendance</CardTitle>
            <Link
              href="/employee/attendance"
              className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          {records.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="Nothing logged yet"
              description="Clock in above to start recording your shift."
            />
          ) : (
            <ul className="divide-y divide-line">
              {records.slice(0, 6).map((record) => (
                <li key={record.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="tabular w-24 shrink-0">{record.date}</span>
                  <span className="tabular flex-1 text-ink-muted">
                    {formatLocal(record.login_time, tz, 'HH:mm')}
                    {record.logout_time
                      ? ` – ${formatLocal(record.logout_time, tz, 'HH:mm')}`
                      : ' – active'}
                  </span>
                  {record.is_late ? <StatusChip status="late" label="Late" /> : null}
                  <span className="tabular w-16 shrink-0 text-right font-medium">
                    {formatHours(record.total_hours)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>My tasks</CardTitle>
              <Link
                href="/employee/tasks"
                className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
              >
                Open board <ArrowRight className="size-3.5" />
              </Link>
            </CardHeader>
            {tasks.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="No tasks assigned"
                description="Work assigned to you shows up here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {tasks.map((task) => (
                  <li key={task.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <StatusChip status={task.priority} />
                    {task.due_date ? (
                      <span className="tabular shrink-0 text-xs text-ink-muted">
                        {task.due_date}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Announcements</CardTitle>
              <Link
                href="/employee/notifications"
                className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
              >
                View all <ArrowRight className="size-3.5" />
              </Link>
            </CardHeader>
            {(notifications.data ?? []).length === 0 ? (
              <EmptyState
                icon={Bell}
                title="Nothing new"
                description="Announcements from your organization appear here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {(notifications.data ?? []).map((item) => (
                  <li key={item.id} className="px-5 py-3">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {formatLocal(item.created_at, tz, 'd MMM, HH:mm')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {(pendingLeaves.data ?? []).length > 0 ? (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>My leave</CardTitle>
                <Link
                  href="/employee/leaves"
                  className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
                >
                  Manage <ArrowRight className="size-3.5" />
                </Link>
              </CardHeader>
              <ul className="divide-y divide-line">
                {(pendingLeaves.data ?? []).map((leave) => (
                  <li key={leave.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="tabular flex-1">
                      {leave.start_date} → {leave.end_date}
                    </span>
                    <StatusChip status={leave.status} />
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
