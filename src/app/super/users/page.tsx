import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { PlatformUserList } from './platform-user-list'
import type { UserRole } from '@/types/db'

export const metadata: Metadata = { title: 'Users' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const ROLES: UserRole[] = ['org', 'employee', 'candidate', 'super_admin']
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
  searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string; visa?: string }>
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

  // Work authorization (056): only people with one expiring within 90 days, or
  // already expired. Resolved to a list of ids first — the expiry lives on
  // another table, and PostgREST cannot filter a page by a join's column.
  const visa = params.visa === 'expiring' || params.visa === 'expired' ? params.visa : null
  if (visa) {
    const today = new Date().toISOString().slice(0, 10)
    const cutoff = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10)
    let visaQuery = admin.from('work_authorizations').select('employee_id')
    visaQuery = visa === 'expired' ? visaQuery.lt('expiry_date', today) : visaQuery.gte('expiry_date', today).lte('expiry_date', cutoff)
    const { data: matches } = await visaQuery
    const ids = Array.from(new Set(((matches ?? []) as Array<{ employee_id: string }>).map((m) => m.employee_id)))
    query = query.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
  }

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

  // Each employee's work authorization: the nearest expiry on record, and the
  // status they gave at onboarding for anyone with no visa row at all.
  const employeeIds = (profiles ?? []).filter((p) => p.role === 'employee').map((p) => p.id)
  const [{ data: auths }, { data: onboarding }] = employeeIds.length
    ? await Promise.all([
        admin
          .from('work_authorizations')
          .select('employee_id, visa_type, expiry_date')
          .in('employee_id', employeeIds)
          .order('expiry_date', { ascending: true }),
        admin
          .from('employee_onboarding')
          .select('employee_profile_id, work_auth_status')
          .in('employee_profile_id', employeeIds),
      ])
    : [{ data: [] }, { data: [] }]

  const visaFor = new Map<string, { type: string; expiry: string }>()
  for (const row of (auths ?? []) as Array<{ employee_id: string; visa_type: string; expiry_date: string }>) {
    if (!visaFor.has(row.employee_id)) visaFor.set(row.employee_id, { type: row.visa_type, expiry: row.expiry_date })
  }
  const statusFor = new Map<string, string>()
  for (const row of (onboarding ?? []) as Array<{ employee_profile_id: string | null; work_auth_status: string | null }>) {
    if (row.employee_profile_id && row.work_auth_status) statusFor.set(row.employee_profile_id, row.work_auth_status)
  }

  const rows = (profiles ?? []).map((profile) => ({
    ...profile,
    visaType: visaFor.get(profile.id)?.type ?? null,
    visaExpiry: visaFor.get(profile.id)?.expiry ?? null,
    workAuthStatus: statusFor.get(profile.id) ?? null,
    tenantName: profile.tenant_id
      ? (tenantName.get(profile.tenant_id) ?? '—')
      : profile.role === 'candidate'
        ? 'Job portal'
        : 'Platform',
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Every account across the platform, with each employee's company and work authorization. You can deactivate, but not edit, customer accounts."
      />
      <PlatformUserList
        users={rows}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filtered={!!search || !!role || !!status || !!visa}
      />
    </div>
  )
}
