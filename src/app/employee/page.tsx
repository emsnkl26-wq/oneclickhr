import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import {
  CalendarCheck, Clock, TimerReset, ArrowRight, Bell, ClipboardList,
  Briefcase, Timer, CheckCircle2, XCircle, UserRoundPen,
} from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'
import {
  StatCard, PageHeader, EmptyState, StatusChip, Skeleton, StatCardSkeleton, ListCardSkeleton,
} from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { formatLocal } from '@/lib/time'
import { formatHours, cn } from '@/lib/utils'
import { ShiftToggle } from './shift-toggle'
import { MyPlacementsCard } from '@/app/org/placements/my-placements-card'
import {
  employeeWindow,
  loadAnnouncements,
  loadCurrentShift,
  loadMonthAttendance,
  loadMyLeaves,
  loadMyTasks,
  loadOnboardingState,
  loadWorkCounts,
} from './dashboard-data'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

/**
 * The employee dashboard, STREAMED.
 *
 * Nothing in this component body costs a round trip — `employeeWindow()`
 * resolves the context the layout guard already fetched and does date
 * arithmetic. The greeting and the page frame are in the first flush of HTML,
 * and every region below fetches independently.
 *
 * The ordering of the boundaries follows what people actually come here to do.
 * The clock-in control is the first region on the page and reads TWO narrow
 * attendance rows; it used to arrive only after the onboarding lookup, the
 * month's attendance, five tasks, four announcements, every placement and three
 * timesheet counts had all finished. An employee starting their shift now gets
 * the button roughly as fast as the server can answer a primary-key lookup, and
 * the rest of the page fills in underneath them while they use it.
 */
export default async function EmployeeDashboard() {
  const { ctx, tz } = await employeeWindow()

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello${ctx.fullName ? `, ${ctx.fullName.split(' ')[0]}` : ''}`}
        description={formatLocal(new Date(), tz, 'EEEE, d MMMM yyyy')}
        actions={<ThemeToggle className="border border-line bg-card text-ink-muted hover:bg-page hover:text-ink" />}
      />

      {/*
        Above everything, including the clock-in control. Someone who has just
        been handed a login has exactly one thing to do here, and burying it
        under seven stat cards is how it goes undone for a fortnight.

        No fallback. This banner is absent for everybody whose onboarding is
        finished — which is almost everybody — so a skeleton here would promise
        a task to people who have none and then withdraw it. It is also the one
        region whose arrival SHIFTS what is underneath, which is why it is not
        allowed to hold up the clock: the alternative was every employee waiting
        on a lookup that concerns a handful of them.
      */}
      <Suspense fallback={null}>
        <OnboardingBanner />
      </Suspense>

      {/*
        The clock is hidden only from somebody an org has deliberately put on
        timesheets (025) — for them it is a control that would fail if they used
        it, since `/api/employee/clock` refuses the wrong mode.

        An UNSET mode still gets the clock. Treating "nobody has decided" as
        "does not clock in" is what removed it from every employee's dashboard
        in every workspace on the day this shipped.
      */}
      {ctx.trackingMode !== 'timesheet' && ctx.trackingMode !== 'none' ? (
        <Suspense fallback={<ShiftToggleSkeleton />}>
          <CurrentShift />
        </Suspense>
      ) : ctx.trackingMode === 'timesheet' ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
          <Timer className="size-5 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">This week&rsquo;s timesheet</p>
            <p className="text-[13px] text-ink-muted">
              You record your hours weekly rather than clocking in and out.
            </p>
          </div>
          <Button asChild>
            <Link href="/employee/timesheets">
              Open timesheets
              <ArrowRight />
            </Link>
          </Button>
        </div>
      ) : null}

      {/*
        Two boundaries over one grid, not one over both. The three attendance
        cards and the four work counts come from different queries, and pairing
        them would hold the faster one back; `<Suspense>` emits no DOM, so all
        seven stay direct children of the same grid either way.
      */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Suspense
          fallback={
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          }
        >
          <AttendanceStats shiftStart={ctx.tenant.workStartTime} />
        </Suspense>
        <Suspense
          fallback={
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          }
        >
          <WorkStats />
        </Suspense>
      </div>

      {/* Read-only, from `my_assignments` — pay rate only, never the bill rate. */}
      <Suspense fallback={<ListCardSkeleton rows={2} />}>
        <Placements />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<ListCardSkeleton rows={6} />}>
          <RecentAttendance tz={tz} />
        </Suspense>

        <div className="space-y-4">
          <Suspense fallback={<ListCardSkeleton rows={4} />}>
            <MyTasks />
          </Suspense>
          <Suspense fallback={<ListCardSkeleton rows={4} />}>
            <Announcements tz={tz} />
          </Suspense>
          {/* Absent entirely when there is no leave on file — no fallback, for
              the same reason as the onboarding banner. */}
          <Suspense fallback={null}>
            <MyLeave />
          </Suspense>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- Streamed regions */

async function OnboardingBanner() {
  const { ctx } = await employeeWindow()
  const onboarding = await loadOnboardingState()

  // An approved onboarding still loads (so its owner can correct details from
  // their profile), but there is nothing left to ask of them here.
  if (!onboarding || onboarding.status === 'completed') return null

  const submitted = onboarding.status === 'submitted'

  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-2xl border p-5 sm:flex-row sm:items-center sm:p-6',
        submitted ? 'border-line bg-page' : 'border-brand-200 bg-brand-50/60'
      )}
    >
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-full',
          submitted ? 'bg-card text-ink-muted' : 'bg-brand-600 text-white'
        )}
      >
        {submitted ? (
          <CheckCircle2 className="size-5" aria-hidden />
        ) : (
          <UserRoundPen className="size-5" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {submitted
            ? 'Your onboarding details are being reviewed'
            : onboarding.reviewNotes
              ? `${ctx.tenant.name} asked for a change to your details`
              : 'Complete your onboarding details'}
        </p>
        <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
          {submitted
            ? `${ctx.tenant.name} has everything you submitted. You will be notified if anything needs changing.`
            : 'Your address, work authorization, emergency contact and a few documents. About ten minutes, and you can save and come back.'}
        </p>
      </div>
      <Button asChild variant={submitted ? 'secondary' : 'default'}>
        <Link href="/employee/onboarding">
          {submitted ? 'View what you sent' : 'Fill in my details'}
          <ArrowRight />
        </Link>
      </Button>
    </div>
  )
}

async function CurrentShift() {
  const { ctx, tz } = await employeeWindow()
  const current = await loadCurrentShift()

  return (
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
  )
}

async function AttendanceStats({ shiftStart }: { shiftStart: string }) {
  const { records, totalHours, lateCount } = await loadMonthAttendance()

  return (
    <>
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
        hint={`Shift starts at ${shiftStart}`}
      />
    </>
  )
}

async function WorkStats() {
  const counts = await loadWorkCounts()

  return (
    <>
      <StatCard
        label="Projects"
        value={counts.activeProjects}
        icon={Briefcase}
        tone="orange"
        href="/employee/projects"
        hint="Active assignments"
      />
      <StatCard
        label="Timesheets"
        value={counts.timesheets}
        icon={Timer}
        tone="pink"
        href="/employee/timesheets"
      />
      <StatCard
        label="Approved"
        value={counts.approved}
        icon={CheckCircle2}
        tone="purple"
        href="/employee/timesheets"
      />
      <StatCard
        label="Rejected"
        value={counts.rejected}
        icon={XCircle}
        tone="indigo"
        href="/employee/timesheets"
        hint={counts.rejected ? 'Needs your attention' : 'Nothing returned'}
      />
    </>
  )
}

async function Placements() {
  const supabase = await createSupabaseServerClient()
  return <MyPlacementsCard supabase={supabase} />
}

async function RecentAttendance({ tz }: { tz: string }) {
  const { records } = await loadMonthAttendance()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Recent attendance</CardTitle>
        <Link
          href="/employee/attendance"
          className="flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
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
  )
}

async function MyTasks() {
  const tasks = await loadMyTasks()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>My tasks</CardTitle>
        <Link
          href="/employee/tasks"
          className="flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
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
                <span className="tabular shrink-0 text-xs text-ink-muted">{task.due_date}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

async function Announcements({ tz }: { tz: string }) {
  const items = await loadAnnouncements()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Announcements</CardTitle>
        <Link
          href="/employee/notifications"
          className="flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
        >
          View all <ArrowRight className="size-3.5" />
        </Link>
      </CardHeader>
      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="Nothing new"
          description="Announcements from your organization appear here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => (
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
  )
}

async function MyLeave() {
  const leaves = await loadMyLeaves()
  if (leaves.length === 0) return null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>My leave</CardTitle>
        <Link
          href="/employee/leaves"
          className="flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
        >
          Manage <ArrowRight className="size-3.5" />
        </Link>
      </CardHeader>
      <ul className="divide-y divide-line">
        {leaves.map((leave) => (
          <li key={leave.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <span className="tabular flex-1">
              {leave.start_date} → {leave.end_date}
            </span>
            <StatusChip status={leave.status} />
          </li>
        ))}
      </ul>
    </Card>
  )
}

/* --------------------------------------------------- Region-sized fallback */

/** Matches the ShiftToggle bar: status text on the left, the control on the right. */
function ShiftToggleSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className="h-10 w-32 shrink-0 rounded-lg" />
    </div>
  )
}
