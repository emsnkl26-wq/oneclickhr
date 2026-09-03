import type { Metadata } from 'next'
import { ExternalLink } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { JOB_COLUMNS } from '@/lib/jobs'
import { JobWorkspace, type JobRow } from './job-workspace'
import { toFormValues } from '@/lib/job-form'
import type { Job } from '@/types/db'

export const metadata: Metadata = { title: 'Jobs' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const FILTERS = ['all', 'published', 'draft', 'closed'] as const
type Filter = (typeof FILTERS)[number]

/**
 * Every posting this workspace has, live or not.
 *
 * Read through the user-scoped client, so `jobs_select` is what confines this to
 * the tenant — there is no `.eq('tenant_id', …)` below and there should not be.
 * The org clause in that policy is also what makes DRAFTS visible here, which is
 * the one thing the public portal can never see.
 */
export default async function OrgJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const filter: Filter = FILTERS.includes(params.status as Filter)
    ? (params.status as Filter)
    : 'all'
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = supabase
    .from('jobs')
    .select(JOB_COLUMNS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (filter !== 'all') query = query.eq('status', filter)
  if (search) {
    const term = search.replace(/[,()*\\]/g, ' ').trim()
    if (term) query = query.or(`title.ilike.%${term}%,location.ilike.%${term}%`)
  }

  const [{ data, count }, { data: departments }] = await Promise.all([
    query,
    supabase.from('departments').select('id, name').order('name'),
  ])

  const rows: JobRow[] = ((data ?? []) as unknown as Job[]).map((job) => ({
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
    form: toFormValues(job),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description="Post a role here and it appears on the public job portal the moment you publish it."
        actions={
          <Button variant="secondary" asChild>
            <a href="/jobs" target="_blank" rel="noreferrer">
              <ExternalLink />
              View the portal
            </a>
          </Button>
        }
      />

      <JobWorkspace
        jobs={rows}
        departments={(departments ?? []) as Array<{ id: string; name: string }>}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filter={filter}
        searching={!!search}
      />
    </div>
  )
}
