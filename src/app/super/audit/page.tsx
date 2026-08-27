import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { AuditViewer } from './audit-viewer'
import { isActionGroup } from './action-groups'

export const metadata: Metadata = { title: 'Audit log' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50

/**
 * The platform audit trail, paged.
 *
 * It used to load the thousand most recent entries so the browser could filter
 * them. An audit log is append-only and grows forever, so that is the one table
 * in the product guaranteed to keep getting bigger — a fixed window over it is
 * both the heaviest query on the platform and, past a busy week, wrong. The
 * filters are now part of the query, served by audit_logs_action_idx and
 * audit_logs_tenant_idx.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string; page?: string }>
}) {
  await requireSuperAdmin()
  const admin = createAdminClient()
  const params = await searchParams

  const search = params.q?.trim() || ''
  const group = isActionGroup(params.action) ? params.action : null
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = admin
    .from('audit_logs')
    .select('id, tenant_id, actor_email, action, entity, entity_id, ip, meta, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  // Actions are namespaced ("employee.deactivated"), so a group is a prefix
  // match — which the btree on `action` can serve directly.
  if (group) query = query.like('action', `${group}.%`)
  if (search) {
    const term = search.replace(/[(),"*\\]/g, ' ').trim()
    if (term) query = query.or(`action.ilike.%${term}%,actor_email.ilike.%${term}%,entity.ilike.%${term}%`)
  }

  const [{ data: logs, count }, { data: tenants }] = await Promise.all([
    query,
    admin.from('tenants').select('id, name'),
  ])

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]))

  const rows = (logs ?? []).map((log) => ({
    ...log,
    tenantName: log.tenant_id ? (tenantName.get(log.tenant_id) ?? 'Unknown') : 'Platform',
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Append-only. There is no update or delete path for these records, anywhere in the product."
      />
      <AuditViewer
        logs={rows}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filtered={!!search || !!group}
      />
    </div>
  )
}
