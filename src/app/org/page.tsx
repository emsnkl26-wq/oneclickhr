import type { Metadata } from 'next'
import Link from 'next/link'
import {
  Users, CalendarCheck, CalendarOff, BadgeCheck, UserPlus, ArrowRight,
  Briefcase, Timer, LifeBuoy,
} from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard, EmptyState, PageHeader, StatusChip } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { todayIn, formatLocal, daysUntil, addDays } from '@/lib/time'
import { initials } from '@/lib/utils'

export const metadata: Metadata = { title: 'Dashboard' }
export const dynamic = 'force-dynamic'

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
   * Two things this list is careful about:
   *
   *   • Employee NAMES come back as embedded rows, not from a follow-up
   *     `.in('id', …)`. That lookup could not start until the leave and visa
   *     queries had both finished, so it added a serial round trip to a
   *     dashboard whose other five queries were already running in parallel.
   *   • The two "how many?" cards read `count`, not `rows.length`. The rows are
   *     capped at five for display, so counting them capped the numbers at five
   *     as well — a workspace with forty pending requests reported four.
   */
  const visaHorizon = addDays(today, 120)

  const [
    employees,
    todayAttendance,
    pendingLeaves,
    recentHires,
    expiringVisas,
    activeProjects,
    pendingTimesheets,
    openTickets,
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
        'id, employee_id, start_date, end_date, days, reason, status, created_at, employee:profiles!leaves_employee_id_fkey(full_name, email)',
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
  ])

  /** PostgREST returns a one-to-one embed as an object, or null when unmatched. */
  type EmbeddedPerson = { full_name: string | null; email: string | null } | null
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Good to see you${ctx.fullName ? `, ${ctx.fullName.split(' ')[0]}` : ''}`}
        description={`Here is what is happening at ${ctx.tenant.name} today.`}
        actions={
          <Button asChild>
            <Link href="/org/employees/onboard">
              <UserPlus />
              Add employee
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total employees"
          value={totalEmployees}
          icon={Users}
          accent
          href="/org/employees"
          hint={totalEmployees === 0 ? 'Add your first teammate' : 'Active accounts'}
        />
        <StatCard
          label="Clocked in today"
          value={presentToday}
          icon={CalendarCheck}
          href="/org/attendance"
          hint={
            totalEmployees
              ? `${Math.round((presentToday / totalEmployees) * 100)}% of the team`
              : 'No employees yet'
          }
        />
        <StatCard
          label="Pending leave"
          value={pendingLeaveCount}
          icon={CalendarOff}
          href="/org/leaves"
          hint={pendingLeaveCount ? 'Awaiting your decision' : 'Nothing to review'}
        />
        <StatCard
          label="Visas expiring"
          value={expiringVisaCount}
          icon={BadgeCheck}
          href="/org/visa"
          hint={expiringVisaCount ? 'Within the next 120 days' : 'Nothing upcoming'}
        />
        <StatCard
          label="Active projects"
          value={activeProjects.count ?? 0}
          icon={Briefcase}
          tone="orange"
          href="/org/projects"
        />
        <StatCard
          label="Timesheets to approve"
          value={pendingTimesheets.count ?? 0}
          icon={Timer}
          tone="pink"
          href="/org/timesheets"
          hint={pendingTimesheets.count ? 'Awaiting your decision' : 'Nothing to review'}
        />
        <StatCard
          label="Open tickets"
          value={openTickets.count ?? 0}
          icon={LifeBuoy}
          tone="purple"
          href="/org/helpdesk"
          hint={openTickets.count ? 'Raised by your team' : 'Nothing outstanding'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Leave awaiting approval</CardTitle>
            <Link
              href="/org/leaves"
              className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {displayName(leave.employee)}
                    </p>
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
            <Link
              href="/org/employees"
              className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
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
            <Link
              href="/org/visa"
              className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
            >
              Manage <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-line">
              {visas.map((visa) => {
                const days = daysUntil(visa.expiry_date, tz)
                return (
                  <li key={visa.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {displayName(visa.employee)}
                      </p>
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
