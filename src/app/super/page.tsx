import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { Building2, Users, UserCheck, PauseOctagon, ArrowRight } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  StatCard, PageHeader, EmptyState, StatusChip, Skeleton, StatCardSkeleton, ListCardSkeleton,
} from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { SignupsChart } from './signups-chart-loader'
import { formatLocal } from '@/lib/time'

export const metadata: Metadata = { title: 'Platform overview' }
export const dynamic = 'force-dynamic'

/** How far back the signups plot looks. */
const TREND_WEEKS = 12

/*
 * Deliberately unscoped: this is the platform-wide view, and every loader below
 * runs only after `requireSuperAdmin()`. Every OTHER admin-client query in this
 * codebase re-filters by tenant_id — the contrast is the point. Cross-tenant
 * reads happen here and nowhere else.
 */

/**
 * The Monday of the earliest week the plot covers, as `YYYY-MM-DD`.
 *
 * Shared by the chart and the query that feeds it so the window asked of the
 * database and the window drawn are the same one.
 */
function trendWeekStarts(): string[] {
  const now = new Date()
  const weeks: string[] = []
  for (let i = TREND_WEEKS - 1; i >= 0; i--) {
    const day = new Date(now)
    day.setDate(now.getDate() - i * 7)
    // ISO week: Monday is day 0.
    const dow = (day.getDay() + 6) % 7
    day.setDate(day.getDate() - dow)
    weeks.push(day.toISOString().slice(0, 10))
  }
  return weeks
}

/**
 * The four headline counts.
 *
 * All four are `head: true` counts now. The organizations figure used to come
 * from `allTenants.length` — the length of a `select('id, created_at, status')`
 * with NO filter and NO limit, which is every row in the table, pulled across
 * the wire on every load of this page, to be counted and then thrown away. It
 * grows with the business, which is the worst property a query on the landing
 * page of the platform console can have.
 */
const loadPlatformCounts = cache(async () => {
  const admin = createAdminClient()

  const [tenants, orgUsers, employees, suspended] = await Promise.all([
    admin.from('tenants').select('id', { count: 'exact', head: true }),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'org'),
    admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'employee'),
    admin.from('tenants').select('id', { count: 'exact', head: true }).eq('status', 'suspended'),
  ])

  return {
    tenants: tenants.count ?? 0,
    orgUsers: orgUsers.count ?? 0,
    employees: employees.count ?? 0,
    suspended: suspended.count ?? 0,
  }
})

/**
 * Signups bucketed by ISO week.
 *
 * Bounded to the window the chart actually draws. The old version read the
 * whole `tenants` table and discarded everything older than twelve weeks in
 * JavaScript; this asks the index for the twelve weeks and nothing else, and
 * selects one column instead of three.
 *
 * The buckets are generated first and then filled, so a week with no signups is
 * a ZERO rather than a missing point — a line that skips its empty weeks draws
 * steady growth out of a quarter of silence.
 */
const loadSignupTrend = cache(async () => {
  const weeks = trendWeekStarts()
  const earliest = weeks[0]
  const admin = createAdminClient()

  const { data } = await admin
    .from('tenants')
    .select('created_at')
    .gte('created_at', earliest)
    .limit(10000)

  const buckets = new Map(weeks.map((week) => [week, 0]))
  for (const tenant of data ?? []) {
    const created = new Date(tenant.created_at)
    const dow = (created.getDay() + 6) % 7
    created.setDate(created.getDate() - dow)
    const key = created.toISOString().slice(0, 10)
    const current = buckets.get(key)
    if (current !== undefined) buckets.set(key, current + 1)
  }

  return Array.from(buckets.entries()).map(([week, count]) => ({ week, count }))
})

const loadRecentTenants = cache(async () => {
  const admin = createAdminClient()
  const { data } = await admin
    .from('tenants')
    .select('id, name, slug, status, created_at')
    .order('created_at', { ascending: false })
    .limit(6)
  return data ?? []
})

const loadRecentAudit = cache(async () => {
  const admin = createAdminClient()
  const { data } = await admin
    .from('audit_logs')
    .select('id, action, actor_email, entity, created_at')
    .order('created_at', { ascending: false })
    .limit(8)
  return data ?? []
})

const loadFailedCron = cache(async () => {
  const admin = createAdminClient()
  const { data } = await admin
    .from('cron_runs')
    .select('id, job, ok, created_at, detail')
    .order('created_at', { ascending: false })
    .limit(5)
  return (data ?? []).filter((run) => !run.ok)
})

/**
 * The platform console's landing page, STREAMED.
 *
 * Seven queries used to share one `Promise.all` and therefore one finish line;
 * the slowest — an unbounded scan of every tenant — decided when the page
 * appeared. Each region now fetches on its own and paints on its own.
 */
export default async function SuperDashboard() {
  await requireSuperAdmin()

  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" description="Every organization on OneclickHR." />

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
          <PlatformCounts />
        </Suspense>
      </div>

      {/* An alert that is absent in the healthy case gets no skeleton — see the
          note on the org dashboard's visa panel. */}
      <Suspense fallback={null}>
        <CronAlert />
      </Suspense>

      <Card>
        <CardHeader>
          <CardTitle>Signups over the last {TREND_WEEKS} weeks</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-[220px] w-full rounded-lg" />}>
            <Signups />
          </Suspense>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<ListCardSkeleton rows={6} />}>
          <NewestOrganizations />
        </Suspense>
        <Suspense fallback={<ListCardSkeleton rows={8} />}>
          <RecentActivity />
        </Suspense>
      </div>
    </div>
  )
}

/* ------------------------------------------------------- Streamed regions */

async function PlatformCounts() {
  const counts = await loadPlatformCounts()
  return (
    <>
      <StatCard
        label="Organizations"
        value={counts.tenants}
        icon={Building2}
        accent
        href="/super/organizations"
      />
      <StatCard label="Org accounts" value={counts.orgUsers} icon={UserCheck} href="/super/users" />
      <StatCard label="Employee accounts" value={counts.employees} icon={Users} href="/super/users" />
      <StatCard
        label="Suspended"
        value={counts.suspended}
        icon={PauseOctagon}
        href="/super/organizations"
        hint={counts.suspended ? 'Access is blocked for these' : 'All workspaces active'}
      />
    </>
  )
}

async function CronAlert() {
  const failed = await loadFailedCron()
  if (failed.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
      <p className="text-sm font-semibold text-amber-900">
        {failed.length} recent background job{failed.length === 1 ? '' : 's'} failed
      </p>
      <p className="mt-1 text-[13px] text-amber-800">
        Check <Link href="/super/system" className="underline">system health</Link> — visa
        reminders and calendar sync depend on these running.
      </p>
    </div>
  )
}

async function Signups() {
  const data = await loadSignupTrend()
  return <SignupsChart data={data} />
}

async function NewestOrganizations() {
  const tenants = await loadRecentTenants()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Newest organizations</CardTitle>
        <Link
          href="/super/organizations"
          className="flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
        >
          View all <ArrowRight className="size-3.5" />
        </Link>
      </CardHeader>
      {tenants.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No organizations yet"
          description="They appear here as soon as someone signs up."
        />
      ) : (
        <ul className="divide-y divide-line">
          {tenants.map((tenant) => (
            <li key={tenant.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/super/organizations/${tenant.id}`}
                  className="block truncate text-sm font-medium hover:text-brand-ink hover:underline"
                >
                  {tenant.name}
                </Link>
                <p className="truncate text-xs text-ink-muted">/{tenant.slug}</p>
              </div>
              <StatusChip status={tenant.status} />
              <span className="shrink-0 text-xs text-ink-muted">
                {formatLocal(tenant.created_at, 'UTC', 'd MMM')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

async function RecentActivity() {
  const entries = await loadRecentAudit()

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Recent platform activity</CardTitle>
        <Link
          href="/super/audit"
          className="flex items-center gap-1 text-[13px] font-medium text-brand-ink hover:underline"
        >
          Full log <ArrowRight className="size-3.5" />
        </Link>
      </CardHeader>
      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet" description="Actions appear here as they happen." />
      ) : (
        <ul className="divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 px-5 py-2.5">
              <code className="shrink-0 rounded bg-page px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                {entry.action}
              </code>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">
                {entry.actor_email || 'system'}
              </span>
              <span className="shrink-0 text-xs text-ink-muted">
                {formatLocal(entry.created_at, 'UTC', 'd MMM, HH:mm')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
