'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BriefcaseBusiness, Plus, Pencil, ExternalLink, Users } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { LinkTabs } from '@/components/ui/link-tabs'
import { SearchField } from '@/components/ui/search-field'
import { Pagination } from '@/components/ui/pagination'
import { JobDialog, type JobFormValues, type DepartmentOption } from './job-dialog'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatDateLabel, formatInstantLabel } from '@/lib/time'
import type { JobStatus, JobType, JobWorkplace } from '@/types/db'

export interface JobRow {
  id: string
  title: string
  status: JobStatus
  employmentType: JobType
  workplace: JobWorkplace
  location: string | null
  openings: number
  applicationCount: number
  publishedAt: string | null
  closesAt: string | null
  /** Everything the edit dialog needs, so opening it costs no round trip. */
  form: JobFormValues
}

const TYPE_LABELS: Record<JobType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
}

const WORKPLACE_LABELS: Record<JobWorkplace, string> = {
  onsite: 'On site',
  remote: 'Remote',
  hybrid: 'Hybrid',
}

/**
 * `jobs` is ONE page the database has already filtered. Nothing here narrows it
 * further — the tabs and the search box write to the URL and the server answers,
 * which is the contract every other list in the app follows.
 */
export function JobWorkspace({
  jobs, departments, total, page, perPage, filter, searching, endpoint = '/api/org/jobs',
  detailBase = '/org/jobs', canCreate = true,
}: {
  jobs: JobRow[]
  departments: DepartmentOption[]
  total: number
  page: number
  perPage: number
  filter: string
  searching: boolean
  endpoint?: string
  detailBase?: string
  canCreate?: boolean
}) {
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<JobRow | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function setStatus(job: JobRow, status: JobStatus) {
    setBusyId(job.id)
    try {
      await apiPatch(`${endpoint}/${job.id}`, { status })
      toast.success(
        status === 'published'
          ? 'Published — it is live on the job portal'
          : status === 'closed'
            ? 'Closed. It is no longer on the portal.'
            : 'Moved back to draft'
      )
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.'
      )
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<JobRow>[] = [
    {
      key: 'title',
      header: 'Role',
      cell: (row) => (
        <div className="min-w-0">
          <Link href={`${detailBase}/${row.id}`} className="block truncate font-medium hover:underline">
            {row.title}
          </Link>
          <p className="truncate text-xs text-ink-muted">
            {TYPE_LABELS[row.employmentType]} · {WORKPLACE_LABELS[row.workplace]}
            {row.location ? ` · ${row.location}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'applicants',
      header: 'Applicants',
      className: 'w-28',
      cell: (row) => (
        <Link
          href={`${detailBase}/${row.id}`}
          className="tabular inline-flex items-center gap-1.5 font-medium text-brand-600 hover:underline"
        >
          <Users className="size-3.5" aria-hidden />
          {row.applicationCount}
        </Link>
      ),
    },
    {
      key: 'openings',
      header: 'Openings',
      className: 'w-24 text-right',
      headerClassName: 'text-right',
      cell: (row) => <span className="tabular">{row.openings}</span>,
    },
    {
      key: 'dates',
      header: 'Posted',
      cell: (row) => (
        <div className="whitespace-nowrap text-ink-muted">
          {/*
            * `published_at` is a timestamptz, so it needs the INSTANT helper.
            * `formatDateLabel` is for a plain `date` column — handed a timestamp
            * it used to print the raw ISO string straight onto the page.
            */}
          <span className="tabular">{formatInstantLabel(row.publishedAt)}</span>
          {row.closesAt ? (
            <span className="tabular block text-xs">
              closes {formatDateLabel(row.closesAt)}
            </span>
          ) : null}
        </div>
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
      className: 'w-[190px]',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1.5">
          {/*
            * Publishing is a LABELLED button, not an icon.
            *
            * It was an eye glyph, and an eye means "preview" to most people —
            * not "put this on the public internet". The one action here with
            * consequences outside the workspace is the one that has to say what
            * it does. View and Edit stay as icons: both are reversible and
            * neither leaves the building.
            */}
          {row.status === 'published' ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busyId === row.id}
              onClick={() => setStatus(row, 'closed')}
            >
              Unpublish
            </Button>
          ) : (
            <Button size="sm" loading={busyId === row.id} onClick={() => setStatus(row, 'published')}>
              Publish
            </Button>
          )}
          {row.status === 'published' ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`View ${row.title} on the portal`}
              asChild
            >
              <a href={`/jobs/${row.id}`} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          ) : null}
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Edit ${row.title}`}
            onClick={() => setEditing(row)}
          >
            <Pencil />
          </Button>
        </div>
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
            { value: 'published', label: 'Live' },
            { value: 'draft', label: 'Drafts' },
            { value: 'closed', label: 'Closed' },
          ]}
        />

        <div className="flex items-center gap-3">
          <SearchField
            param="q"
            placeholder="Search roles"
            label="Search jobs"
            className="sm:w-64 sm:flex-none"
          />
          {canCreate ? (
            <Button onClick={() => setCreating(true)} className="shrink-0">
              <Plus />
              New job
            </Button>
          ) : null}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={jobs}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={BriefcaseBusiness}
            title={searching ? 'No roles match that' : 'No jobs yet'}
            description={
              searching
                ? 'Try a different title or location.'
                : 'Post a role and it appears on the public job portal as soon as you publish it.'
            }
            action={
              searching || !canCreate ? null : (
                <Button onClick={() => setCreating(true)}>Post a job</Button>
              )
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <JobDialog
        open={creating}
        departments={departments}
        endpoint={endpoint}
        onClose={() => setCreating(false)}
        onSaved={(published) => {
          setCreating(false)
          toast.success(
            published
              ? 'Published — it is live on the job portal'
              : 'Draft saved. Publish it when you are ready.'
          )
          router.refresh()
        }}
      />

      <JobDialog
        open={!!editing}
        departments={departments}
        endpoint={endpoint}
        job={editing?.form}
        isPublished={editing?.status === 'published'}
        onClose={() => setEditing(null)}
        onSaved={(published) => {
          setEditing(null)
          toast.success(published ? 'Published — it is live on the job portal' : 'Job updated')
          router.refresh()
        }}
      />
    </div>
  )
}

