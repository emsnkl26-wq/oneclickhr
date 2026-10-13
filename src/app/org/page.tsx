import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Users, CalendarCheck, CalendarOff, BadgeCheck, UserPlus, ArrowRight,
  Briefcase, Timer, LifeBuoy, FilePlus2, TrendingUp, TrendingDown, Minus,
  type LucideIcon,
} from 'lucide-react'
import { EmptyState, StatusChip, Skeleton, StatCardSkeleton, ListCardSkeleton } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { formatLocal, daysUntil, addDays } from '@/lib/time'
import { formatMoney, totalExpenses, totalPayroll, totalRevenue } from '@/lib/expenses'
import { cn, initials } from '@/lib/utils'
// The two plots come from the loader, not from `dashboard-charts` directly:
// importing them statically would pull ~105kB of recharts into this route's
// bundle, which is what made the landing page of the org portal the heaviest
// screen in the app. The gauge is hand-drawn SVG and stays eager — it is one
// number above the fold and costs nothing.
import { AttendanceTrend, HoursTrend } from './dashboard-charts-loader'
import { AttendanceGauge } from './dashboard-gauge'
import type { AttendancePoint, HoursPoint } from './dashboard-charts'
import { ThemeToggle } from '@/components/theme-toggle'
import {
  TREND_DAYS,
  dashboardWindow,
  displayName,
  loadAttendanceWindow,
  loadExpiringVisas,
  loadHeadcount,
  loadMonthMoney,
  loadOperations,
  loadPendingLeaves,
  loadRecentHires,
  loadWaitingOnYou,
} from './dashboard-data'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `2026-02-12` → `{ short: '12 Feb', full: 'Thu, 12 Feb', weekend: false }`. */
function describeDay(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const short = `${d} ${MONTH_ABBR[m - 1]}`
  return { short, full: `${DAY_ABBR[weekday]}, ${short}`, weekend: weekday === 0 || weekday === 6 }
}

/**
 * The dashboard, STREAMED.
 *
 * This component awaits nothing that costs a round trip. `dashboardWindow()`
 * resolves the context the layout's guard already fetched (both go through the
 * same request-scoped `cache()`) and does date arithmetic; everything that
 * touches the database lives in an async child behind its own `<Suspense>`.
 *
 * So the frame — greeting, both call-to-action buttons, every card's chrome —
 * is in the first flush of HTML, and the regions fill in independently as their
 * own queries land. The fortnight-wide attendance scan no longer holds up the
 * headcount cards, and the money card no longer waits on either.
 *
 * React starts all Suspense children CONCURRENTLY, so splitting the page costs
 * no extra latency: the same queries are in flight at the same moment they were
 * under the old single `Promise.all`, they simply no longer share a finish
 * line. Overlapping reads are deduplicated by `cache()` in ./dashboard-data.
 *
 * Every fallback is sized to the content it stands in for — see the note on the
 * skeleton block in src/components/ui/patterns.tsx. A region that resolves into
 * a differently-sized box makes the page jump, which is worse than waiting.
 */
export default async function OrgDashboard() {
  const { ctx, tz } = await dashboardWindow()
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
        <ThemeToggle className="absolute right-4 top-4 z-10 border border-line bg-card/70 text-ink-muted backdrop-blur hover:bg-page hover:text-ink" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="pr-10 text-[13px] font-medium uppercase tracking-[0.14em] text-brand-ink">
              {formatLocal(new Date(), tz, 'EEEE, d MMMM yyyy')}
            </p>
            <h1 className="mt-2 text-[26px] font-bold tracking-[-0.02em] text-ink sm:text-[30px]">
              Good to see you{firstName ? `, ${firstName}` : ''}
            </h1>
            {/*
              The greeting itself is free; only the tally underneath needs two
              counts. Boxed on its own so the name is not held behind them —
              the fallback is a single text-height bar in the same slot.
            */}
            <Suspense
              fallback={<Skeleton className="mt-2 h-4 w-72 max-w-full" />}
            >
              <WaitingLine tenantName={ctx.tenant.name} />
            </Suspense>
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
      {/*
        The grid lives OUT here and the boundary inside it: `<Suspense>` renders
        no DOM of its own, so the four cards — and the four skeletons standing in
        for them — are direct grid children either way and the tracks never move.
      */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          <HeadlineCards />
        </Suspense>
      </div>

      {/* ------------------------------------------------------------ Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Suspense fallback={<ChartCardSkeleton />}>
          <AttendanceSection />
        </Suspense>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Today</CardTitle>
            </CardHeader>
            <CardContent className="pb-6 pt-1">
              <Suspense fallback={<GaugeSkeleton />}>
                <TodayGauge />
              </Suspense>
            </CardContent>
          </Card>

          <Card className="flex-1">
            <CardHeader>
              <CardTitle>Operations</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-line">
                <Suspense fallback={<OperationRowsSkeleton />}>
                  <OperationRows />
                </Suspense>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ----------------------------------------------------------- Money ---
        What this month cost and what came in. Deliberately three plain figures
        and no chart: the useful question here is "are we up or down", and a
        sparkline of two data points answers it worse than the number does.
      */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>This month</CardTitle>
            <CardDescription>
              Collected against everything spent, including payroll.
            </CardDescription>
          </div>
          <ViewAll href="/org/expenses" label="Expenses" />
        </CardHeader>
        <CardContent>
          <Suspense fallback={<MoneySkeleton />}>
            <MonthMoney />
          </Suspense>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------- Lists */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<ListCardSkeleton rows={4} avatar />}>
          <PendingLeaveCard />
        </Suspense>
        <Suspense fallback={<ListCardSkeleton rows={4} avatar />}>
          <RecentHiresCard tz={tz} />
        </Suspense>
      </div>

      {/*
        No fallback for the visa panel. It is the only region that renders
        NOTHING when it is empty, and most workspaces have no expiry inside the
        horizon — a skeleton card here would promise content to the majority of
        readers and then vanish, which is a worse artefact than a late arrival
        at the very bottom of the page.
      */}
      <Suspense fallback={null}>
        <ExpiringVisas tz={tz} />
      </Suspense>
    </div>
  )
}

/* ------------------------------------------------------- Streamed regions */

async function WaitingLine({ tenantName }: { tenantName: string }) {
  const waiting = await loadWaitingOnYou()
  return (
    <p className="mt-1.5 text-sm text-ink-muted">
      {waiting > 0
        ? `${waiting} ${waiting === 1 ? 'item is' : 'items are'} waiting on you at ${tenantName}.`
        : `Nothing is waiting on you at ${tenantName} today.`}
    </p>
  )
}

async function HeadlineCards() {
  // Three independent loaders, raced rather than awaited one after another:
  // this region paints when the slowest of the three lands, not their sum.
  const [headcount, leaves, visas] = await Promise.all([
    loadHeadcount(),
    loadPendingLeaves(),
    loadExpiringVisas(),
  ])

  return (
    <>
      <MetricCard
        label="Total employees"
        value={headcount.total}
        icon={Users}
        tone="brand"
        href="/org/employees"
        footer={
          headcount.total === 0
            ? { kind: 'hint', text: 'Add your first teammate' }
            : { kind: 'hint', text: 'Active accounts' }
        }
      />
      <MetricCard
        label="Present today"
        value={headcount.present}
        icon={CalendarCheck}
        tone="indigo"
        href="/org/attendance"
        footer={
          headcount.total
            ? { kind: 'meter', text: `${headcount.rate}% of the team`, percent: headcount.rate }
            : { kind: 'hint', text: 'No employees yet' }
        }
      />
      <MetricCard
        label="Pending leave"
        value={leaves.count}
        icon={CalendarOff}
        tone="orange"
        href="/org/leaves"
        footer={{
          kind: 'hint',
          text: leaves.count ? 'Awaiting your decision' : 'Nothing to review',
        }}
      />
      <MetricCard
        label="Visas expiring"
        value={visas.count}
        icon={BadgeCheck}
        tone={visas.count ? 'pink' : 'emerald'}
        href="/org/visa"
        footer={{
          kind: 'hint',
          text: visas.count ? 'Within the next 120 days' : 'Nothing upcoming',
        }}
      />
    </>
  )
}

async function AttendanceSection() {
  const { trendStart } = await dashboardWindow()
  const [rows, headcount] = await Promise.all([loadAttendanceWindow(), loadHeadcount()])

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
  for (const row of rows) {
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

  return (
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
        <AttendanceTrend data={attendanceSeries} headcount={headcount.total} />

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
  )
}

async function TodayGauge() {
  const headcount = await loadHeadcount()
  return <AttendanceGauge present={headcount.present} total={headcount.total} />
}

async function OperationRows() {
  const ops = await loadOperations()
  return (
    <>
      <OperationRow
        icon={Briefcase}
        tone="orange"
        label="Active projects"
        value={ops.activeProjects}
        href="/org/projects"
      />
      <OperationRow
        icon={Timer}
        tone="pink"
        label="Timesheets to approve"
        value={ops.pendingTimesheets}
        href="/org/timesheets"
      />
      <OperationRow
        icon={LifeBuoy}
        tone="purple"
        label="Open tickets"
        value={ops.openTickets}
        href="/org/helpdesk"
      />
    </>
  )
}

async function MonthMoney() {
  const { ctx } = await dashboardWindow()
  const money = await loadMonthMoney()

  /*
   * This month's money, all in the workspace's own currency. Rows in another
   * one are COUNTED and reported, never converted — a wrong rate is worse than
   * an honest omission. See the header of src/lib/expenses.ts.
   */
  const currency = ctx.tenant.defaultCurrency
  const loggedSpend = totalExpenses(money.expenses, currency)
  const payroll = totalPayroll(money.payroll, currency)
  const revenue = totalRevenue(money.invoices, currency)
  const spend = loggedSpend.total + payroll.total
  const netResult = revenue.total - spend
  const excludedRows = loggedSpend.excluded + payroll.excluded + revenue.excluded

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyFigure label="Revenue collected" value={formatMoney(revenue.total, currency)} />
        <MoneyFigure label="Total spend" value={formatMoney(spend, currency)} />
        <MoneyFigure
          label={netResult >= 0 ? 'Profit' : 'Loss'}
          value={formatMoney(Math.abs(netResult), currency)}
          tone={netResult >= 0 ? 'good' : 'bad'}
        />
      </div>
      {excludedRows > 0 ? (
        // Said out loud rather than quietly converted — see src/lib/expenses.ts.
        <p className="mt-3 text-xs text-ink-muted">
          {excludedRows} {excludedRows === 1 ? 'entry is' : 'entries are'} in another currency
          and {excludedRows === 1 ? 'is' : 'are'} not counted here. Nothing has been converted.
        </p>
      ) : null}
    </>
  )
}

async function PendingLeaveCard() {
  const { rows } = await loadPendingLeaves()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Leave awaiting approval</CardTitle>
        <ViewAll href="/org/leaves" />
      </CardHeader>
      {rows.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="No pending requests"
          description="Leave applications from your team will appear here for approval."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((leave) => (
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
  )
}

async function RecentHiresCard({ tz }: { tz: string }) {
  const hires = await loadRecentHires()

  return (
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
  )
}

async function ExpiringVisas({ tz }: { tz: string }) {
  const { rows } = await loadExpiringVisas()
  if (rows.length === 0) return null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Upcoming work authorization expiries</CardTitle>
        <ViewAll href="/org/visa" label="Manage" />
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y divide-line">
          {rows.map((visa) => {
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
  )
}

/* --------------------------------------------------- Region-sized fallbacks */

/** Matches AttendanceSection: a two-column-wide card holding plot + sub-plot. */
function ChartCardSkeleton() {
  return (
    <div className="card-surface lg:col-span-2">
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <Skeleton className="h-6 w-16 shrink-0 rounded-full" />
      </div>
      <div className="px-3 pb-4 sm:px-4">
        <Skeleton className="h-[200px] w-full rounded-lg" />
        <div className="mt-4 border-t border-line px-1 pt-4 sm:px-2">
          <div className="mb-2 flex items-baseline justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-[90px] w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
}

/** The gauge is a wide arc with a figure under it. */
function GaugeSkeleton() {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <Skeleton className="h-[86px] w-[170px] rounded-t-full" />
      <Skeleton className="h-3 w-28" />
    </div>
  )
}

function OperationRowsSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <Skeleton className="h-3.5 flex-1 max-w-[160px]" />
          <Skeleton className="h-5 w-8 shrink-0" />
        </li>
      ))}
    </>
  )
}

function MoneySkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg bg-page px-4 py-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2 h-6 w-24" />
        </div>
      ))}
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

function MoneyFigure({
  label, value, tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
}) {
  return (
    <div className="rounded-lg bg-page px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</p>
      <p
        className={`tabular mt-1 text-xl font-bold ${
          tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-danger' : ''
        }`}
      >
        {value}
      </p>
    </div>
  )
}

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
      className="group flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
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
