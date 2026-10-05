import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { StorageConsole, type RequestRow, type TenantUsage } from './storage-console'

export const metadata: Metadata = { title: 'Storage' }
export const dynamic = 'force-dynamic'

/**
 * Workspace storage (056): requests for more space waiting on a decision, and
 * every organization's usage against its limit.
 */
export default async function SuperStoragePage() {
  await requireSuperAdmin()
  const admin = createAdminClient()

  const [{ data: requests }, { data: tenants }] = await Promise.all([
    admin
      .from('storage_requests')
      .select('id, tenant_id, requested_bytes, reason, status, granted_bytes, admin_note, created_at, decided_at')
      .order('created_at', { ascending: false })
      .limit(100),
    admin
      .from('tenants')
      .select('id, name, storage_used_bytes, storage_limit_bytes')
      .order('storage_used_bytes', { ascending: false })
      .limit(500),
  ])

  const names = new Map(((tenants ?? []) as Array<{ id: string; name: string }>).map((t) => [t.id, t.name]))

  const requestRows: RequestRow[] = ((requests ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    tenantId: r.tenant_id as string,
    tenantName: names.get(r.tenant_id as string) ?? 'Unknown',
    requestedBytes: Number(r.requested_bytes),
    reason: r.reason as string,
    status: r.status as RequestRow['status'],
    grantedBytes: r.granted_bytes == null ? null : Number(r.granted_bytes),
    adminNote: (r.admin_note as string | null) ?? null,
    createdAt: r.created_at as string,
  }))

  const usage: TenantUsage[] = ((tenants ?? []) as Array<Record<string, unknown>>).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    used: Number(t.storage_used_bytes ?? 0),
    limit: Number(t.storage_limit_bytes ?? 1024 ** 3),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage"
        description="Every workspace starts with 1 GB. Approve requests for more, or set a limit directly."
      />
      <StorageConsole requests={requestRows} tenants={usage} />
    </div>
  )
}
