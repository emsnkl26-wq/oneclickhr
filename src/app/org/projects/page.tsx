import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { projectHourTotals } from '@/lib/projects'
import { PageHeader } from '@/components/ui/patterns'
import { ProjectWorkspace, type ProjectRow } from './project-workspace'
import type { ProjectStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Projects' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const FILTERS = ['all', 'active', 'inactive', 'completed'] as const
type Filter = (typeof FILTERS)[number]

/** The row plus its embedded assignment rows, as PostgREST returns them. */
interface ProjectWithAssignments {
  id: string
  code: string
  name: string
  client_name: string | null
  end_client_name: string | null
  start_date: string | null
  end_date: string | null
  status: ProjectStatus
  created_at: string
  assignments: Array<{
    employee: {
      id: string
      full_name: string | null
      email: string | null
      photo_url: string | null
      designation: string | null
    } | null
  }>
}

/**
 * Every project in the workspace, with its team and its approved hours.
 *
 * The team arrives as an EMBEDDED join rather than a second `.in('project_id', …)`
 * query — that lookup could not start until the project list had returned, so it
 * put a serial round trip in front of a page that otherwise costs one. The hours
 * come from `project_hour_totals()`, a single grouped aggregate, for the same
 * reason: summing them in Node would mean shipping every timesheet line in the
 * tenant to count them.
 */
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const filter: Filter = FILTERS.includes(params.status as Filter)
    ? (params.status as Filter)
    : 'all'
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = supabase
    .from('projects')
    .select(
      'id, code, name, client_name, end_client_name, start_date, end_date, status, created_at, assignments:project_assignments(employee:profiles(id, full_name, email, photo_url, designation))',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (filter !== 'all') query = query.eq('status', filter)
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,code.ilike.%${search}%,client_name.ilike.%${search}%,end_client_name.ilike.%${search}%`
    )
  }

  const [{ data, count }, { data: employees }, totals] = await Promise.all([
    query,
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url, designation')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name'),
    projectHourTotals(supabase),
  ])

  const rows: ProjectRow[] = ((data ?? []) as unknown as ProjectWithAssignments[]).map(
    (project) => ({
      id: project.id,
      code: project.code,
      name: project.name,
      clientName: project.client_name,
      endClientName: project.end_client_name,
      startDate: project.start_date,
      endDate: project.end_date,
      status: project.status,
      totalHours: totals.get(project.id) ?? 0,
      members: project.assignments
        .map((assignment) => assignment.employee)
        .filter(Boolean) as ProjectRow['members'],
    })
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="The engagements your team logs hours against."
      />
      <ProjectWorkspace
        projects={rows}
        employees={employees ?? []}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filter={filter}
        searching={!!search}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
