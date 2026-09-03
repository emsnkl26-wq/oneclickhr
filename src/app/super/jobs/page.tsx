import type { Metadata } from 'next'
import { ExternalLink } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { JOB_COLUMNS } from '@/lib/jobs'
import { SuperJobConsole, type SuperJobRow } from './super-job-console'
import { toFormValues } from '@/lib/job-form'
import type { Job } from '@/types/db'

export const metadata: Metadata = { title: 'Jobs' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const FILTERS = ['all', 'published', 'draft', 'closed', 'platform'] as const
type Filter = (typeof FILTERS)[number]

/**
 * Every posting on the platform — Oneclickhr's own and every customer's.
 *
 * Read with the service role and deliberately unscoped, in the same shape as
 * /super/organizations: `requireSuperAdmin()` above IS the boundary, and RLS is
 * not being asked to express "all tenants" because that is not a thing a policy
 * should ever say.
 *
 * `platform` is a filter rather than a separate page. The two things a super
 * admin does here — post Oneclickhr's own roles, and pull down a customer's bad
 * one — are the same list viewed two ways, and splitting them would mean
 * discovering the moderation queue only if you knew to look for it.
 */
export default async function SuperJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  await requireSuperAdmin()
  const admin = createAdminClient()
  const params = await searchParams

  const filter: Filter = FILTERS.includes(params.status as Filter)
    ? (params.status as Filter)
    : 'all'
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = admin
    .from('jobs')
    .select(JOB_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (filter === 'platform') query = query.is('tenant_id', null)
  else if (filter !== 'all') query = query.eq('status', filter)

  if (search) {
    const term = search.replace(/[,()*\\]/g, ' ').trim()
    if (term) query = query.or(`title.ilike.%${term}%,location.ilike.%${term}%`)
  }

  const { data, count } = await query
  const jobs = (data ?? []) as unknown as Job[]

  // One lookup for the whole page rather than an embed, so the tenant join never
  // becomes part of the filter surface on an unscoped query.
  const tenantIds = Array.from(
    new Set(jobs.map((job) => job.tenant_id).filter((id): id is string => !!id))
  )
  const { data: tenants } = tenantIds.length
    ? await admin.from('tenants').select('id, name').in('id', tenantIds)
    : { data: [] }

  const names = new Map(
    ((tenants ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])
  )

  const rows: SuperJobRow[] = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    status: job.status,
    employmentType: job.employment_type,
    workplace: job.workplace,
    location: job.location,
    openings: job.openings,
    applicationCount: job.application_count,
    publishedAt: job.published_at,
    closesAt: job.closes_at,
    companyName: job.tenant_id ? (names.get(job.tenant_id) ?? 'Unknown workspace') : 'Oneclickhr',
    isPlatform: !job.tenant_id,
    form: toFormValues(job),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description="Every posting on the portal. Post Oneclickhr's own roles here, and unpublish anything that should not be public."
        actions={
          <Button variant="secondary" asChild>
            <a href="/jobs" target="_blank" rel="noreferrer">
              <ExternalLink />
              View the portal
            </a>
          </Button>
        }
      />

      <SuperJobConsole
        jobs={rows}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filter={filter}
        searching={!!search}
      />
    </div>
  )
}
