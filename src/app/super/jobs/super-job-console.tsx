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
import { JobDialog } from '@/app/org/jobs/job-dialog'
import type { JobFormValues } from '@/lib/job-form'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatDateLabel, formatInstantLabel } from '@/lib/time'
import type { JobStatus, JobType, JobWorkplace } from '@/types/db'

export interface SuperJobRow {
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
  companyName: string
  isPlatform: boolean
  form: JobFormValues
}

/**
 * The platform's view of every posting.
 *
 * Two capabilities that the org console does not have, and one it does not lose:
 *
 *   • Unpublish ANY job, including a customer's. The portal carries Oneclickhr's
 *     name, so a posting that is fraudulent or abusive has to come down without
 *     waiting for the org that wrote it.
 *   • Post Oneclickhr's own roles, which carry no tenant.
 *
 * What it deliberately cannot do is EDIT a customer's posting. Taking a role
 * down is moderation; rewriting someone's advert under their own company name is
 * not, and the API refuses it regardless of what this UI offers — the edit
 * button simply does not appear rather than surfacing a 403 nobody expected.
 */
export function SuperJobConsole({
  jobs, total, page, perPage, filter, searching,
}: {
  jobs: SuperJobRow[]
  total: number
  page: number
  perPage: number
  filter: string
  searching: boolean
}) {
  const router = useRouter()
  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<SuperJobRow | null>(null)
  const [busyId, setBusyId] = React.useState<string | null>(null)

  async function setStatus(job: SuperJobRow, status: JobStatus) {
    if (
      status === 'closed' &&
      !job.isPlatform &&
      !window.confirm(
        `Unpublish "${job.title}" from ${job.companyName}?\n\n` +
          'It comes off the public portal immediately. The organization keeps the posting and ' +
          'can republish it, and this action is recorded in their audit log under your name.'
      )
    ) {
      return
    }

    setBusyId(job.id)
    try {
      await apiPatch(`/api/super/jobs/${job.id}`, { status })
      toast.success(status === 'published' ? 'Published to the portal' : 'Taken off the portal')
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.'
      )
    } finally {
      setBusyId(null)
    }
  }

  const columns: Column<SuperJobRow>[] = [
    {
      key: 'title',
      header: 'Role',
      cell: (row) => (
        <div className="min-w-0">
          <span className="block truncate font-medium">{row.title}</span>
          <p className="truncate text-xs text-ink-muted">
            {row.location || row.workplace}
            {row.closesAt ? ` · closes ${formatDateLabel(row.closesAt)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'company',
      header: 'Workspace',
      cell: (row) => (
        <span className="inline-flex items-center gap-2">
          <span className="truncate">{row.companyName}</span>
          {row.isPlatform ? (
            <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
              Ours
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'applicants',
      header: 'Applicants',
      className: 'w-28',
      cell: (row) => (
        <span className="tabular inline-flex items-center gap-1.5 text-ink-muted">
          <Users className="size-3.5" aria-hidden />
          {row.applicationCount}
        </span>
      ),
    },
    {
      key: 'published',
      header: 'Posted',
      cell: (row) => (
        // A timestamptz needs the INSTANT helper — `formatDateLabel` is for a
        // plain `date` column and would print the raw ISO string.
        <span className="tabular whitespace-nowrap text-ink-muted">
          {formatInstantLabel(row.publishedAt)}
        </span>
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
          {/* Labelled, like the org console — an eye glyph reads as "preview",
              and taking a customer's posting off the internet is not that. */}
          {row.status === 'published' ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busyId === row.id}
              onClick={() => setStatus(row, 'closed')}
            >
              Unpublish
            </Button>
          ) : row.isPlatform ? (
            <Button
              size="sm"
              loading={busyId === row.id}
              onClick={() => setStatus(row, 'published')}
            >
              Publish
            </Button>
          ) : (
            // A customer's DRAFT is theirs to publish — the platform has no
            // business pushing an unfinished posting live under their name.
            // Republishing one it took down stays available.
            <Button
              size="sm"
              variant="secondary"
              loading={busyId === row.id}
              disabled={row.status === 'draft'}
              onClick={() => setStatus(row, 'published')}
            >
              Republish
            </Button>
          )}
          {row.status === 'published' ? (
            <Button size="icon" variant="ghost" aria-label={`View ${row.title}`} asChild>
              <a href={`/jobs/${row.id}`} target="_blank" rel="noreferrer">
                <ExternalLink />
              </a>
            </Button>
          ) : null}
          {row.isPlatform ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Edit ${row.title}`}
              onClick={() => setEditing(row)}
            >
              <Pencil />
            </Button>
          ) : null}
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
          resets={['page']}
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'published', label: 'Live' },
            { value: 'draft', label: 'Drafts' },
            { value: 'closed', label: 'Closed' },
            { value: 'platform', label: 'Ours' },
          ]}
        />

        <div className="flex items-center gap-3">
          <SearchField
            param="q"
            placeholder="Search roles"
            label="Search jobs"
            className="sm:w-64 sm:flex-none"
          />
          <Button onClick={() => setCreating(true)} className="shrink-0">
            <Plus />
            Post for Oneclickhr
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={jobs}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={BriefcaseBusiness}
            title={searching ? 'No roles match that' : 'Nothing posted yet'}
            description={
              searching
                ? 'Try a different title or location.'
                : 'When organizations start posting, their roles appear here alongside our own.'
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <JobDialog
        open={creating}
        endpoint="/api/super/jobs"
        onClose={() => setCreating(false)}
        onSaved={(published) => {
          setCreating(false)
          toast.success(
            published ? 'Published to the portal' : 'Draft saved. Publish it when you are ready.'
          )
          router.refresh()
        }}
      />

      <JobDialog
        open={!!editing}
        endpoint="/api/super/jobs"
        job={editing?.form}
        isPublished={editing?.status === 'published'}
        onClose={() => setEditing(null)}
        onSaved={(published) => {
          setEditing(null)
          toast.success(published ? 'Published to the portal' : 'Job updated')
          router.refresh()
        }}
      />
    </div>
  )
}
