'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Briefcase, Plus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { AvatarStack, type StackedPerson } from '@/components/ui/avatar-stack'
import { LinkTabs } from '@/components/ui/link-tabs'
import { SearchField } from '@/components/ui/search-field'
import { Pagination } from '@/components/ui/pagination'
import { ProjectDialog } from './project-dialog'
import { formatDateLabel } from '@/lib/time'
import { formatHours } from '@/lib/utils'
import type { ProjectStatus } from '@/types/db'

export interface ProjectRow {
  id: string
  code: string
  name: string
  clientName: string | null
  endClientName: string | null
  startDate: string | null
  endDate: string | null
  status: ProjectStatus
  totalHours: number
  members: StackedPerson[]
}

export interface EmployeeOption {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
  designation: string | null
}

/**
 * `projects` is ONE page the database has already filtered. Nothing here narrows
 * it further — the tabs and the search box write to the URL and the server
 * answers, which is the same contract every other list in the app follows.
 */
export function ProjectWorkspace({
  projects, employees, total, page, perPage, filter, searching,
}: {
  projects: ProjectRow[]
  employees: EmployeeOption[]
  total: number
  page: number
  perPage: number
  filter: string
  searching: boolean
  timezone: string
}) {
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<ProjectRow | null>(null)

  const columns: Column<ProjectRow>[] = [
    {
      key: 'code',
      header: 'Project ID',
      className: 'w-28',
      cell: (row) => (
        <Link
          href={`/org/projects/${row.id}`}
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
        <div className="min-w-0">
          <Link href={`/org/projects/${row.id}`} className="block truncate font-medium hover:underline">
            {row.name}
          </Link>
          {row.endClientName ? (
            <p className="truncate text-xs text-ink-muted">End client · {row.endClientName}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      cell: (row) => <span className="text-ink-muted">{row.clientName || '—'}</span>,
    },
    {
      key: 'team',
      header: 'Assigned',
      cell: (row) => <AvatarStack people={row.members} />,
    },
    {
      key: 'dates',
      header: 'Dates',
      cell: (row) => (
        <span className="tabular whitespace-nowrap text-ink-muted">
          {formatDateLabel(row.startDate)}
          {row.endDate ? ` – ${formatDateLabel(row.endDate)}` : ''}
        </span>
      ),
    },
    {
      key: 'hours',
      header: 'Total hours',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => (
        <span className="tabular font-medium">{row.totalHours ? formatHours(row.totalHours) : '—'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-14',
      cell: (row) => (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Edit ${row.name}`}
          onClick={() => setEditing(row)}
        >
          <Pencil />
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <LinkTabs
          param="status"
          active={filter}
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'completed', label: 'Completed' },
          ]}
        />

        <div className="flex items-center gap-3">
          <SearchField
            param="q"
            placeholder="Search projects or clients"
            label="Search projects"
            className="sm:w-64 sm:flex-none"
          />
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <Plus />
            New project
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={projects}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Briefcase}
            title={searching ? 'No projects match that' : 'No projects yet'}
            description={
              searching
                ? 'Try a different name, code or client.'
                : 'Create a project so your team can log hours against it.'
            }
            action={
              searching ? null : <Button onClick={() => setCreating(true)}>Create a project</Button>
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <ProjectDialog
        open={creating}
        employees={employees}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false)
          toast.success('Project created')
          router.refresh()
        }}
      />

      <ProjectDialog
        open={!!editing}
        employees={employees}
        project={
          editing
            ? {
                id: editing.id,
                name: editing.name,
                clientName: editing.clientName ?? '',
                endClientName: editing.endClientName ?? '',
                description: '',
                startDate: editing.startDate ?? '',
                endDate: editing.endDate ?? '',
                status: editing.status,
                employeeIds: editing.members.map((member) => member.id),
              }
            : undefined
        }
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          toast.success('Project updated')
          router.refresh()
        }}
      />
    </div>
  )
}
