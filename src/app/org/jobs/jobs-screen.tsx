import { ExternalLink } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { JOB_COLUMNS, JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS } from '@/lib/jobs'
import { JobWorkspace, type JobRow } from './job-workspace'
import { toFormValues } from '@/lib/job-form'
import { loadJobDialogExtras } from '@/lib/job-recruiters'
import type { Job } from '@/types/db'

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
export type JobsSearchParams = Promise<{
  status?: string; q?: string; page?: string; type?: string; workplace?: string
}>

/**
 * Shared by /org/jobs and a recruiter's /employee/jobs (056) — the same list,
 * the same dialog, only the link base differs. `tenantId` is the caller's own;
 * both routes guard before rendering this.
 */
export async function JobsScreen({
  tenantId,
  searchParams,
  base,
}: {
  tenantId: string
  searchParams: JobsSearchParams
  base: string
}) {
  const ctx = { tenantId }
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
    // Explicit, on top of `jobs_select`: an org never lists another tenant's roles.
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (filter !== 'all') query = query.eq('status', filter)
  if (params.type && params.type in JOB_TYPE_LABELS) query = query.eq('employment_type', params.type)
  if (params.workplace && params.workplace in JOB_WORKPLACE_LABELS) {
    query = query.eq('workplace', params.workplace)
  }
  if (search) {
    const term = search.replace(/[,()*\\]/g, ' ').trim()
    if (term) query = query.or(`title.ilike.%${term}%,location.ilike.%${term}%`)
  }

  const [{ data, count }, { data: departments }, extras] = await Promise.all([
    query,
    supabase.from('departments').select('id, name').order('name'),
    loadJobDialogExtras(tenantId),
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
        searching={!!search || !!params.type || !!params.workplace}
        detailBase={base}
        recruiters={extras.recruiters}
        companyLinkedinUrl={extras.companyLinkedinUrl}
      />
    </div>
  )
}
