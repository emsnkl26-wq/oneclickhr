import type { Metadata } from 'next'
import Link from 'next/link'
import { Briefcase } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { projectHourTotals } from '@/lib/projects'
import { PageHeader, StatCard, DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { formatDateLabel } from '@/lib/time'
import { formatHours } from '@/lib/utils'
import type { ProjectStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Projects' }
export const dynamic = 'force-dynamic'

interface AssignedProject {
  id: string
  code: string
  name: string
  client_name: string | null
  end_client_name: string | null
  start_date: string | null
  end_date: string | null
  status: ProjectStatus
}

/**
 * The projects this employee is on — and only those.
 *
 * The scoping is the `projects_select` policy, which lets an employee see a
 * project only when `app.is_project_member(id)` is true. Querying `projects`
 * directly would therefore already be correct; going through
 * `project_assignments` is how the list stays a list of ASSIGNMENTS, which is
 * what the employee is actually being shown.
 *
 * `project_hour_totals()` runs SECURITY INVOKER, so the hours it returns here
 * are this employee's own approved hours, not the whole project's.
 */
export default async function EmployeeProjectsPage() {
  await requireEmployee()
  const supabase = await createSupabaseServerClient()

  const [{ data: assignments }, totals] = await Promise.all([
    supabase
      .from('project_assignments')
      .select('project:projects(id, code, name, client_name, end_client_name, start_date, end_date, status)')
      .order('created_at', { ascending: false }),
    projectHourTotals(supabase),
  ])

  const projects = ((assignments ?? []) as unknown as Array<{ project: AssignedProject | null }>)
    .map((row) => row.project)
    .filter(Boolean) as AssignedProject[]

  const activeCount = projects.filter((project) => project.status === 'active').length
  const myHours = projects.reduce((sum, project) => sum + (totals.get(project.id) ?? 0), 0)

  const columns: Column<AssignedProject>[] = [
    {
      key: 'code',
      header: 'Project ID',
      className: 'w-28',
      cell: (row) => (
        <Link
          href={`/employee/projects/${row.id}`}
          className="tabular font-medium text-brand-600 hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: 'name',
      header: 'Project',
      cell: (row) => (
        <Link href={`/employee/projects/${row.id}`} className="block truncate font-medium hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      cell: (row) => <span className="text-ink-muted">{row.client_name || '—'}</span>,
    },
    {
      key: 'endClient',
      header: 'End client',
      cell: (row) => <span className="text-ink-muted">{row.end_client_name || '—'}</span>,
    },
    {
      key: 'dates',
      header: 'Dates',
      cell: (row) => (
        <span className="tabular whitespace-nowrap text-ink-muted">
          {formatDateLabel(row.start_date)}
          {row.end_date ? ` – ${formatDateLabel(row.end_date)}` : ''}
        </span>
      ),
    },
    {
      key: 'hours',
      header: 'My hours',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => {
        const hours = totals.get(row.id) ?? 0
        return <span className="tabular font-medium">{hours ? formatHours(hours) : '—'}</span>
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Projects" description="The engagements you are assigned to." />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Active projects" value={activeCount} icon={Briefcase} tone="orange" accent />
        <StatCard label="All projects" value={projects.length} />
        <StatCard
          label="My approved hours"
          value={myHours ? formatHours(myHours) : '—'}
          hint="Across every project"
        />
      </div>

      <DataTable
        columns={columns}
        rows={projects}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Briefcase}
            title="No projects assigned"
            description="When your organization assigns you to a project it will appear here, and you will be able to log hours against it."
          />
        }
      />
    </div>
  )
}
