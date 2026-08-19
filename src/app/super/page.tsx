import type { Metadata } from 'next'
import Link from 'next/link'
import { Building2, Users, UserCheck, PauseOctagon, ArrowRight } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { StatCard, PageHeader, EmptyState, StatusChip } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { SignupsChart } from './signups-chart'
import { formatLocal } from '@/lib/time'

export const metadata: Metadata = { title: 'Platform overview' }
export const dynamic = 'force-dynamic'

export default async function SuperDashboard() {
  await requireSuperAdmin()

  /*
   * Deliberately unscoped: this is the platform-wide view, and it is reached
   * only after requireSuperAdmin(). Every OTHER admin-client query in this
   * codebase re-filters by tenant_id — the contrast is the point. Cross-tenant
   * reads happen here and nowhere else.
   */
  const admin = createAdminClient()

  const [tenants, orgUsers, employees, suspended, recentTenants, recentAudit, cronRuns] =
    await Promise.all([
      admin.from('tenants').select('id, created_at, status'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'org'),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'employee'),
      admin
        .from('tenants')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'suspended'),
      admin
        .from('tenants')
        .select('id, name, slug, status, created_at')
        .order('created_at', { ascending: false })
        .limit(6),
      admin
        .from('audit_logs')
        .select('id, action, actor_email, entity, created_at')
        .order('created_at', { ascending: false })
        .limit(8),
      admin
        .from('cron_runs')
        .select('id, job, ok, created_at, detail')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

  const allTenants = tenants.data ?? []

  // Signups over the last 12 weeks, bucketed by ISO week start.
  const buckets = new Map<string, number>()
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const day = new Date(now)
    day.setDate(now.getDate() - i * 7)
    const dow = (day.getDay() + 6) % 7
    day.setDate(day.getDate() - dow)
    buckets.set(day.toISOString().slice(0, 10), 0)
  }
  const earliest = Array.from(buckets.keys())[0]
  for (const tenant of allTenants) {
    const created = new Date(tenant.created_at)
    const dow = (created.getDay() + 6) % 7
    created.setDate(created.getDate() - dow)
    const key = created.toISOString().slice(0, 10)
    if (key >= earliest && buckets.has(key)) {
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
  }
  const chartData = Array.from(buckets.entries()).map(([week, count]) => ({ week, count }))

  const failedCron = (cronRuns.data ?? []).filter((run) => !run.ok)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform overview"
        description="Every organization on Oneclickhr."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Organizations"
          value={allTenants.length}
          icon={Building2}
          accent
          href="/super/organizations"
        />
        <StatCard label="Org accounts" value={orgUsers.count ?? 0} icon={UserCheck} href="/super/users" />
        <StatCard label="Employee accounts" value={employees.count ?? 0} icon={Users} href="/super/users" />
        <StatCard
          label="Suspended"
          value={suspended.count ?? 0}
          icon={PauseOctagon}
          href="/super/organizations"
          hint={suspended.count ? 'Access is blocked for these' : 'All workspaces active'}
        />
      </div>

      {failedCron.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <p className="text-sm font-semibold text-amber-900">
            {failedCron.length} recent background job{failedCron.length === 1 ? '' : 's'} failed
          </p>
          <p className="mt-1 text-[13px] text-amber-800">
            Check <Link href="/super/system" className="underline">system health</Link> — visa
            reminders and calendar sync depend on these running.
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Signups over the last 12 weeks</CardTitle>
        </CardHeader>
        <CardContent>
          <SignupsChart data={chartData} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Newest organizations</CardTitle>
            <Link
              href="/super/organizations"
              className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          {(recentTenants.data ?? []).length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No organizations yet"
              description="They appear here as soon as someone signs up."
            />
          ) : (
            <ul className="divide-y divide-line">
              {(recentTenants.data ?? []).map((tenant) => (
                <li key={tenant.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/super/organizations/${tenant.id}`}
                      className="block truncate text-sm font-medium hover:text-brand-600 hover:underline"
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

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent platform activity</CardTitle>
            <Link
              href="/super/audit"
              className="flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
            >
              Full log <ArrowRight className="size-3.5" />
            </Link>
          </CardHeader>
          {(recentAudit.data ?? []).length === 0 ? (
            <EmptyState title="Nothing recorded yet" description="Actions appear here as they happen." />
          ) : (
            <ul className="divide-y divide-line">
              {(recentAudit.data ?? []).map((entry) => (
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
      </div>
    </div>
  )
}
