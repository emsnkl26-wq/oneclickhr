import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { PlatformUserList } from './platform-user-list'
import type { UserRole } from '@/types/db'

export const metadata: Metadata = { title: 'Users' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const ROLES: UserRole[] = ['org', 'employee', 'super_admin']
const STATUSES = ['active', 'inactive'] as const

/**
 * Every account on the platform — one page at a time.
 *
 * The previous version fetched 2,000 rows and filtered them in the browser,
 * which is a hard ceiling dressed up as a limit: the 2,001st customer account
 * simply stopped appearing, silently, with no indication anything was missing.
 * Filtering, searching and paging now all happen in Postgres, so the answer is
 * correct at any size and the payload is constant.
 */
export default async function PlatformUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }>
}) {
  await requireSuperAdmin()
  const admin = createAdminClient()
  const params = await searchParams

  const search = params.q?.trim() || ''
  const role = ROLES.includes(params.role as UserRole) ? (params.role as UserRole) : null
  const status = STATUSES.includes(params.status as never) ? params.status! : null
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = admin
    .from('profiles')
    .select('id, full_name, email, role, tenant_id, is_active, must_change_password, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (role) query = query.eq('role', role)
  if (status) query = query.eq('is_active', status === 'active')
  // `or` with two ilike branches so a search matches either the person or the
  // address. `%` is the only wildcard PostgREST reads here, and the term is
  // stripped of the comma and parenthesis that would otherwise end the filter.
  if (search) {
    const term = search.replace(/[(),"*\\]/g, ' ').trim()
    if (term) query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
  }

  const [{ data: profiles, count }, { data: tenants }] = await Promise.all([
    query,
    admin.from('tenants').select('id, name'),
  ])

  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name]))

  const rows = (profiles ?? []).map((profile) => ({
    ...profile,
    tenantName: profile.tenant_id ? (tenantName.get(profile.tenant_id) ?? '—') : 'Platform',
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Every account across the platform. You can deactivate, but not edit, customer accounts."
      />
      <PlatformUserList
        users={rows}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filtered={!!search || !!role || !!status}
      />
    </div>
  )
}
