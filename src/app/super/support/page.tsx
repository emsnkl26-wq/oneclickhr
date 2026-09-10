import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { SupportQueue, type SupportRow } from './support-queue'

export const metadata: Metadata = { title: 'Support requests' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50

/**
 * Everything customers have told us.
 *
 * Read with the SERVICE ROLE, deliberately and unusually: this is one of the few
 * genuinely cross-tenant screens in the product, and the whole point is to see
 * every workspace's reports in one queue. `requireSuperAdmin()` is the gate, and
 * 028's select policy would refuse anyone else even through a session client.
 *
 * Everything on this page is USER-SUPPLIED TEXT from other people's workspaces.
 * It is rendered as text and never as markup or a link — see the note in
 * `support-queue.tsx`.
 */
export default async function SuperSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  await requireSuperAdmin()
  const params = await searchParams
  const admin = createAdminClient()

  const status =
    params.status === 'new' || params.status === 'in_progress' || params.status === 'resolved'
      ? params.status
      : null
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = admin
    .from('support_requests')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (status) query = query.eq('status', status)

  const { data, count } = await query

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support requests"
        description="What customers have sent us from inside the product."
      />
      <SupportQueue
        rows={(data ?? []) as unknown as SupportRow[]}
        total={count ?? (data ?? []).length}
        page={page}
        perPage={PER_PAGE}
      />
    </div>
  )
}
