import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Users, CalendarCheck, Receipt, BadgeCheck } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader, StatCard, StatusChip, EmptyState } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatLocal, todayIn } from '@/lib/time'
import { DeleteOrganization } from './delete-organization'

export const metadata: Metadata = { title: 'Organization' }
export const dynamic = 'force-dynamic'

export default async function OrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSuperAdmin()
  const { id } = await params
  const admin = createAdminClient()

  const { data: tenant } = await admin
    .from('tenants')
    .select('id, name, slug, status, primary_color, timezone, work_start_time, created_at, onboarded_at')
    .eq('id', id)
    .maybeSingle()

  if (!tenant) notFound()

  const today = todayIn(tenant.timezone)

  /*
   * Every query below re-filters by tenant_id. The admin client bypasses RLS, so
   * a missing filter here would silently widen a "this organization" panel into
   * "the whole platform" — the filter IS the scope on this client.
   */
  const count = (table: string) =>
    admin.from(table).select('id', { count: 'exact', head: true }).eq('tenant_id', id)

  const [people, attendanceToday, invoices, workAuths, audit, timesheets, jobs, documents] =
    await Promise.all([
    admin
      .from('profiles')
      .select('id, full_name, email, role, is_active, created_at')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false }),
    admin
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', id)
      .eq('date', today),
    admin.from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', id),
    admin
      .from('work_authorizations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', id),
    admin
      .from('audit_logs')
      .select('id, action, actor_email, entity, created_at')
      .eq('tenant_id', id)
      .order('created_at', { ascending: false })
      .limit(12),
    count('timesheets'),
    count('jobs'),
    count('documents'),
  ])

  const members = people.data ?? []
  const employees = members.filter((m) => m.role === 'employee')
  const owners = members.filter((m) => m.role === 'org')

  return (
    <div className="space-y-6">
      <PageHeader
        title={tenant.name}
        description={`/${tenant.slug} · ${tenant.timezone} · shift starts ${tenant.work_start_time}`}
        actions={
          <Button asChild variant="secondary">
            <Link href="/super/organizations">
              <ArrowLeft />
              All organizations
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card p-5 shadow-sm">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-xl text-lg font-bold text-white"
          style={{ background: tenant.primary_color }}
          aria-hidden
        >
          {tenant.name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[17px] font-semibold">{tenant.name}</p>
            <StatusChip status={tenant.status} />
            {!tenant.onboarded_at ? (
              <StatusChip status="pending" label="Onboarding unfinished" />
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-ink-muted">
            Signed up {formatLocal(tenant.created_at, 'UTC', 'd MMMM yyyy')}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Employees" value={employees.length} icon={Users} accent />
        <StatCard label="Clocked in today" value={attendanceToday.count ?? 0} icon={CalendarCheck} />
        <StatCard label="Invoices" value={invoices.count ?? 0} icon={Receipt} />
        <StatCard label="Work authorizations" value={workAuths.count ?? 0} icon={BadgeCheck} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>People ({members.length})</CardTitle>
          </CardHeader>
          {members.length === 0 ? (
            <EmptyState title="No accounts" description="This workspace has no users yet." />
          ) : (
            <ul className="scrollbar-thin max-h-96 divide-y divide-line overflow-y-auto">
              {[...owners, ...employees].map((person) => (
                <li key={person.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {person.full_name || person.email}
                    </p>
                    <p className="truncate text-xs text-ink-muted">{person.email}</p>
                  </div>
                  <StatusChip
                    status={person.role === 'org' ? 'info' : 'neutral'}
                    tone={person.role === 'org' ? 'info' : 'neutral'}
                    label={person.role === 'org' ? 'Owner' : 'Employee'}
                  />
                  <StatusChip status={person.is_active ? 'active' : 'inactive'} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          {(audit.data ?? []).length === 0 ? (
            <EmptyState title="Nothing recorded" description="Actions appear here as they happen." />
          ) : (
            <ul className="divide-y divide-line">
              {(audit.data ?? []).map((entry) => (
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

      <DeleteOrganization
        tenantId={tenant.id}
        name={tenant.name}
        status={tenant.status as 'active' | 'suspended'}
        impact={{
          employees: employees.length,
          admins: owners.length,
          invoices: invoices.count ?? 0,
          timesheets: timesheets.count ?? 0,
          jobs: jobs.count ?? 0,
          documents: documents.count ?? 0,
        }}
      />

      <p className="px-1 text-xs leading-relaxed text-ink-muted">
        Platform oversight covers account state and usage only. Payslips, visa documents and other
        files belonging to this organization are not readable from here — the file route grants no
        super-admin bypass.
      </p>
    </div>
  )
}
