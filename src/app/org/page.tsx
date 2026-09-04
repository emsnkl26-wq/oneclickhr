import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Users, CalendarCheck, CalendarOff, BadgeCheck, UserPlus, ArrowRight,
  Briefcase, Timer, LifeBuoy, FilePlus2, TrendingUp, TrendingDown, Minus,
  type LucideIcon,
} from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { todayIn, formatLocal, daysUntil, addDays } from '@/lib/time'
import { cn, initials } from '@/lib/utils'
import {
  AttendanceTrend, HoursTrend, AttendanceGauge,
  type AttendancePoint, type HoursPoint,
} from './dashboard-charts'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

/** How far back the two plots look. Two weeks reads as "recently" to a manager. */
const TREND_DAYS = 14

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `2026-02-12` → `{ short: '12 Feb', full: 'Thu, 12 Feb', weekend: false }`. */
function describeDay(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const short = `${d} ${MONTH_ABBR[m - 1]}`
  return { short, full: `${DAY_ABBR[weekday]}, ${short}`, weekend: weekday === 0 || weekday === 6 }
}

export default async function OrgDashboard() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const tz = ctx.tenant.timezone
  const today = todayIn(tz)

  /*
   * Every query below runs through the USER-SCOPED client, so RLS scopes each
   * one to this tenant automatically. The explicit `.eq('tenant_id', …)` is
   * absent on purpose — adding it here would suggest the isolation depends on
   * remembering to write it, and on this client it does not.
   *
   * Three things this list is careful about:
   *
   *   • Employee NAMES come back as embedded rows, not from a follow-up
   *     `.in('id', …)`. That lookup could not start until the leave and visa
   *     queries had both finished, so it added a serial round trip to a
   *     dashboard whose other queries were already running in parallel.
   *   • The "how many?" cards read `count`, not `rows.length`. The rows are
   *     capped for display, so counting them capped the numbers as well — a
   *     workspace with forty pending requests reported four.
   *   • The FORTNIGHT of attendance is one range scan on
   *     `(tenant_id, date desc)`, not fourteen count queries. It returns two
   *     narrow columns per clock-in and is bucketed in memory below; a
   *     thousand-person workspace is fourteen thousand rows of two columns,
   *     which is cheaper than fourteen round trips.
   */
  const visaHorizon = addDays(today, 120)
  const trendStart = addDays(today, -(TREND_DAYS - 1))

  const [
    employees,
    todayAttendance,
    pendingLeaves,
    recentHires,
    expiringVisas,
    activeProjects,
    pendingTimesheets,
    openTickets,
    attendanceWindow,
  ] = await Promise.all([
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'employee')
      .eq('is_active', true),
    supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('date', today),
    supabase
      .from('leaves')
      .select(
        'id, employee_id, start_date, end_date, days, reason, status, created_at, employee:profiles!leaves_employee_id_fkey(full_name, email, photo_url)',
        { count: 'exact' }
      )
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url, designation, created_at')
      .eq('role', 'employee')
      .order('created_at', { ascending: false })
      .limit(5),
    // Filtered by the index rather than in JavaScript: the old version took the
    // five soonest expiries and then discarded any beyond the horizon, so a
    // workspace with five far-future visas showed an empty card while a nearer
    // one existed.
    supabase
      .from('work_authorizations')
      .select(
        'id, employee_id, visa_type, expiry_date, employee:profiles!work_authorizations_employee_id_fkey(full_name, email)',
        { count: 'exact' }
      )
      .lte('expiry_date', visaHorizon)
      .order('expiry_date', { ascending: true })
      .limit(5),
    // Three more counts, all `head: true` — an index-only scan each, no rows.
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('timesheets')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted'),
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress']),
    supabase
      .from('attendance')
      .select('date, total_hours')
      .gte('date', trendStart)
      .lte('date', today)
      .limit(20000),
  ])

  /** PostgREST returns a one-to-one embed as an object, or null when unmatched. */
  type EmbeddedPerson = { full_name: string | null; email: string | null; photo_url?: string | null } | null
  const displayName = (person: EmbeddedPerson) =>
    person?.full_name || person?.email || 'Employee'

  const leaveRows = (pendingLeaves.data ?? []) as unknown as Array<{
    id: string
    employee_id: string
    start_date: string
    end_date: string
    days: number
    reason: string
    status: string
    created_at: string
    employee: EmbeddedPerson
  }>
  const hires = recentHires.data ?? []
  const visas = (expiringVisas.data ?? []) as unknown as Array<{
    id: string
    employee_id: string
    visa_type: string
    expiry_date: string
    employee: EmbeddedPerson
  }>

  const totalEmployees = employees.count ?? 0
  const presentToday = todayAttendance.count ?? 0
  const pendingLeaveCount = pendingLeaves.count ?? leaveRows.length
  const expiringVisaCount = expiringVisas.count ?? visas.length

  /*
   * Bucket the fortnight.
   *
   * The days are generated first and then filled, so a day nobody clocked in on
   * is a ZERO in the series rather than a missing point. A chart that silently
   * skips its empty days draws a fortnight of perfect attendance out of a week
   * of absence.
   */
  const clockIns = new Map<string, number>()
  const hours = new Map<string, number>()
  for (const row of (attendanceWindow.data ?? []) as Array<{ date: string; total_hours: number | null }>) {
    clockIns.set(row.date, (clockIns.get(row.date) ?? 0) + 1)
    hours.set(row.date, (hours.get(row.date) ?? 0) + Number(row.total_hours ?? 0))
  }

  const days = Array.from({ length: TREND_DAYS }, (_, index) => addDays(trendStart, index))
  const attendanceSeries: AttendancePoint[] = days.map((date) => {
    const day = describeDay(date)
    return {
      label: day.short,
      fullLabel: day.full,
      value: clockIns.get(date) ?? 0,
      weekend: day.weekend,
    }
  })
  const hoursSeries: HoursPoint[] = days.map((date) => {
    const day = describeDay(date)
    return { label: day.short, fullLabel: day.full, value: Math.round(hours.get(date) ?? 0) }
  })

  /*
   * Week over week, on clock-ins.
   *
   * This is the only number on the page that claims a DIRECTION, so it is worth
   * being precise about what it compares: the last seven days against the seven
   * before them. It is suppressed entirely when the earlier week has no data at
   * all, because "+100%" against zero says nothing.
   */
  const thisWeek = attendanceSeries.slice(7).reduce((sum, point) => sum + point.value, 0)
  const lastWeek = attendanceSeries.slice(0, 7).reduce((sum, point) => sum + point.value, 0)
  const weekDelta = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null

  const totalHoursFortnight = hoursSeries.reduce((sum, point) => sum + point.value, 0)
  const attendanceRate = totalEmployees ? Math.round((presentToday / totalEmployees) * 100) : 0
  const firstName = ctx.fullName ? ctx.fullName.split(' ')[0] : ''

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------------------ Hero */}
      {/*
        * The one place on the dashboard with a colour wash. It carries the
        * greeting and the two things a manager most often arrives here to do, so
        * the rest of the page can stay quiet and let the numbers be the loudest
        * thing on it.
        */}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-7">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-50 via-card to-card dark:from-brand-800/20 dark:via-card dark:to-card"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-brand-600/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-brand-600">
              {formatLocal(new Date(), tz, 'EEEE, d MMMM yyyy')}
            </p>
            <h1 className="mt-2 text-[26px] font-bold tracking-[-0.02em] text-ink sm:text-[30px]">
              Good to see you{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="mt-1.5 text-sm text-ink-muted">
              {pendingLeaveCount + (pendingTimesheets.count ?? 0) > 0
                ? `${pendingLeaveCount + (pendingTimesheets.count ?? 0)} ${
                    pendingLeaveCount + (pendingTimesheets.count ?? 0) === 1 ? 'item is' : 'items are'
                  } waiting on you at ${ctx.tenant.name}.`
                : `Nothing is waiting on you at ${ctx.tenant.name} today.`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="secondary">
              <Link href="/org/letters/new">
                <FilePlus2 />
                Generate offer
              </Link>
            </Button>
            <Button asChild>
              <Link href="/org/employees/onboard">
                <UserPlus />
                Add employee
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------- Headline row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total employees"
          value={totalEmployees}
          icon={Users}
          tone="brand"
          href="/org/employees"
          footer={
            totalEmployees === 0
              ? { kind: 'hint', text: 'Add your first teammate' }
              : { kind: 'hint', text: 'Active accounts' }
          }
        />
        <MetricCard
          label="Clocked in today"
          value={presentToday}
          icon={CalendarCheck}
          tone="indigo"
          href="/org/attendance"
          footer={
            totalEmployees
              ? { kind: 'meter', text: `${attendanceRate}% of the team`, percent: attendanceRate }
              : { kind: 'hint', text: 'No employees yet' }
          }
        />
        <MetricCard
          label="Pending leave"
          value={pendingLeaveCount}
          icon={CalendarOff}
          tone="orange"
          href="/org/leaves"
          footer={{
            kind: 'hint',
            text: pendingLeaveCount ? 'Awaiting your decision' : 'Nothing to review',
          }}
        />
        <MetricCard
          label="Visas expiring"
          value={expiringVisaCount}
          icon={BadgeCheck}
          tone={expiringVisaCount ? 'pink' : 'emerald'}
          href="/org/visa"
          footer={{
            kind: 'hint',
            text: expiringVisaCount ? 'Within the next 120 days' : 'Nothing upcoming',
          }}
        />
      </div>

      {/* ------------------------------------------------------------ Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle>Attendance</CardTitle>
              <p className="mt-0.5 text-[13px] text-ink-muted">
                Clock-ins per day over the last {TREND_DAYS} days. Weekends are shown faded.
              </p>
            </div>
            {weekDelta !== null ? <DeltaChip percent={weekDelta} /> : null}
          </CardHeader>
          <CardContent className="px-3 pb-4 sm:px-4">
            <AttendanceTrend data={attendanceSeries} headcount={totalEmployees} />

            <div className="mt-4 border-t border-line px-1 pt-4 sm:px-2">
              <div className="mb-1 flex items-baseline justify-between">
                <p className="text-[13px] font-medium text-ink">Hours logged</p>
                <p className="tabular text-[13px] text-ink-muted">
                  {totalHoursFortnight.toLocaleString()} h in {TREND_DAYS} days
                </p>
              </div>
              <HoursTrend data={hoursSeries} />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Today</CardTitle>
            </CardHeader>
            <CardContent className="pb-6 pt-1">
              <AttendanceGauge present={presentToday} total={totalEmployees} />
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Operations</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-line">
                <OperationRow
                  icon={Briefcase}
                  tone="orange"
                  label="Active projects"
                  value={activeProjects.count ?? 0}
                  href="/org/projects"
                />
                <OperationRow
                  icon={Timer}
                  tone="pink"
                  label="Timesheets to approve"
                  value={pendingTimesheets.count ?? 0}
                  href="/org/timesheets"
                />
                <OperationRow
                  icon={LifeBuoy}
                  tone="purple"
                  label="Open tickets"
                  value={openTickets.count ?? 0}
                  href="/org/helpdesk"
                />
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------------------- Lists */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Leave awaiting approval</CardTitle>
            <ViewAll href="/org/leaves" />
          </CardHeader>
          {leaveRows.length === 0 ? (
            <EmptyState
              icon={CalendarOff}
              title="No pending requests"
              description="Leave applications from your team will appear here for approval."
            />
          ) : (
            <ul className="divide-y divide-line">
              {leaveRows.map((leave) => (
                <li key={leave.id} className="flex items-center gap-3 px-5 py-3.5">
                  <PersonAvatar
                    name={displayName(leave.employee)}
                    email={leave.employee?.email ?? null}
                    photo={leave.employee?.photo_url ?? null}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{displayName(leave.employee)}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {leave.start_date} → {leave.end_date} · {leave.days}{' '}
                      {leave.days === 1 ? 'day' : 'days'}
                    </p>
                  </div>
                  <StatusChip status={leave.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recently added</CardTitle>
            <ViewAll href="/org/employees" />
          </CardHeader>
          {hires.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No employees yet"
              description="Create accounts for your team and they will receive sign-in details by email."
              action={
                <Button asChild size="sm">
                  <Link href="/org/employees/onboard">Add your first employee</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {hires.map((person) => (
                <li key={person.id}>
                  <Link
                    href={`/org/employees/${person.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-page"
                  >
                    <PersonAvatar
                      name={person.full_name}
                      email={person.email}
                      photo={person.photo_url}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {person.full_name || person.email}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {person.designation || 'No designation'}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-muted">
                      {formatLocal(person.created_at, tz, 'd MMM')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {visas.length > 0 ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Upcoming work authorization expiries</CardTitle>
            <ViewAll href="/org/visa" label="Manage" />
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-line">
              {visas.map((visa) => {
                const days = daysUntil(visa.expiry_date, tz)
                return (
                  <li key={visa.id} className="flex items-center gap-3 px-5 py-3.5">
                    <PersonAvatar
                      name={displayName(visa.employee)}
                      email={visa.employee?.email ?? null}
                      photo={null}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{displayName(visa.employee)}</p>
                      <p className="text-xs text-ink-muted">
                        {visa.visa_type} · expires {visa.expiry_date}
                      </p>
                    </div>
                    <StatusChip
                      status={days <= 7 ? 'urgent' : days <= 30 ? 'high' : 'medium'}
                      label={days <= 0 ? 'Expired' : `${days} days`}
                    />
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------- Metric card */

type MetricTone = 'brand' | 'indigo' | 'orange' | 'pink' | 'purple' | 'emerald'

const TONE_TILE: Record<MetricTone, string> = {
  brand: 'bg-brand-50 text-brand-600 dark:bg-brand-800/25',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  orange: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  pink: 'bg-pink-50 text-pink-600 dark:bg-pink-500/15 dark:text-pink-300',
  purple: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
}

const TONE_METER: Record<MetricTone, string> = {
  brand: 'bg-brand-600',
  indigo: 'bg-indigo-500',
  orange: 'bg-amber-500',
  pink: 'bg-pink-500',
  purple: 'bg-purple-500',
  emerald: 'bg-emerald-500',
}

type MetricFooter =
  | { kind: 'hint'; text: string }
  | { kind: 'meter'; text: string; percent: number }

/**
 * The dashboard's headline number.
 *
 * A tinted tile, an oversized tabular figure and ONE line underneath — which is
 * either a plain hint or a meter, never both. The meter is reserved for values
 * that are genuinely a proportion of a known whole (people present out of people
 * employed); drawing a bar under a count of open tickets would invent a ceiling
 * nobody set.
 */
function MetricCard({
  label, value, icon: Icon, tone, href, footer,
}: {
  label: string
  value: number
  icon: LucideIcon
  tone: MetricTone
  href: string
  footer: MetricFooter
}) {
  return (
    <Link
      href={href}
      className="group card-surface block p-5 transition hover:-translate-y-0.5 hover:shadow-card"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-muted">{label}</p>
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl', TONE_TILE[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
      </div>

      <p className="tabular mt-3 break-words text-[30px] font-bold leading-[1.05] tracking-[-0.025em] text-ink">
        {value.toLocaleString()}
      </p>

      {footer.kind === 'meter' ? (
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-page">
            <div
              className={cn('h-full rounded-full transition-all', TONE_METER[tone])}
              style={{ width: `${Math.min(100, Math.max(footer.percent, 0))}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-ink-muted">{footer.text}</p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">{footer.text}</p>
      )}
    </Link>
  )
}

/* --------------------------------------------------------------- Delta chip */

/**
 * Week-over-week direction. Colour is never the only signal — the arrow and the
 * signed number both say which way it went, which is what keeps it readable to
 * a colour-blind reader and in forced-colours mode.
 */
function DeltaChip({ percent }: { percent: number }) {
  const flat = percent === 0
  const up = percent > 0
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
        flat
          ? 'bg-page text-ink-muted'
          : up
            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
            : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
      )}
      title="This week's clock-ins against the seven days before"
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular">
        {flat ? 'Level' : `${up ? '+' : ''}${percent}%`}
      </span>
      <span className="sr-only">week over week</span>
    </span>
  )
}

/* ------------------------------------------------------------ Small pieces */

function OperationRow({
  icon: Icon, tone, label, value, href,
}: {
  icon: LucideIcon
  tone: MetricTone
  label: string
  value: number
  href: string
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-page"
      >
        <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', TONE_TILE[tone])}>
          <Icon className="size-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{label}</span>
        <span className="tabular shrink-0 text-[17px] font-bold text-ink">{value}</span>
      </Link>
    </li>
  )
}

function ViewAll({ href, label = 'View all' }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
    >
      {label}
      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  )
}

function PersonAvatar({
  name, email, photo,
}: {
  name: string | null
  email: string | null
  photo: string | null
}) {
  return (
    <Avatar className="size-9 shrink-0">
      {photo ? (
        <AvatarImage src={`/api/files/view?key=${encodeURIComponent(photo)}`} alt="" />
      ) : null}
      <AvatarFallback className="text-[11px]">{initials(name, email)}</AvatarFallback>
    </Avatar>
  )
}
