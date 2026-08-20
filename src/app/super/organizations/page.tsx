import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { OrganizationList } from './organization-list'

export const metadata: Metadata = { title: 'Organizations' }
export const dynamic = 'force-dynamic'

export default async function OrganizationsPage() {
  await requireSuperAdmin()
  const admin = createAdminClient()

  /*
   * The counts are aggregated BY POSTGRES.
   *
   * This page used to `select tenant_id, role, is_active from profiles` with no
   * filter at all — every account on the platform, streamed into this function
   * to be tallied in a for-loop. It was already the single largest query in the
   * product and it grows with total customers, so it gets slower precisely as
   * the business succeeds. `platform_tenant_stats()` returns one row per
   * tenant instead: a grouped aggregate, service-role only, defined in
   * 009_performance.sql.
   */
  const [{ data: tenants }, { data: stats }] = await Promise.all([
    admin
      .from('tenants')
      .select('id, name, slug, status, primary_color, timezone, created_at, onboarded_at')
      .order('created_at', { ascending: false }),
    admin.rpc('platform_tenant_stats'),
  ])

  type TenantStat = { tenant_id: string; employees: number; orgs: number; inactive: number }
  const counts = new Map(
    ((stats ?? []) as TenantStat[]).map((row) => [row.tenant_id, row])
  )

  const rows = (tenants ?? []).map((tenant) => ({
    ...tenant,
    employeeCount: Number(counts.get(tenant.id)?.employees ?? 0),
    orgCount: Number(counts.get(tenant.id)?.orgs ?? 0),
    inactiveCount: Number(counts.get(tenant.id)?.inactive ?? 0),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizations"
        description="Every customer workspace on the platform."
      />
      <OrganizationList tenants={rows} />
    </div>
  )
}
