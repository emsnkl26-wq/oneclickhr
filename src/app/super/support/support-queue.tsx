'use client'

/**
 * The support queue, and the one dialog that acts on a row.
 *
 * EVERYTHING HERE IS UNTRUSTED TEXT. Subject, message and page path were typed
 * (or supplied) by a user in some other company's workspace. React escapes it
 * on render, and that is relied on — but the deliberate part is what is NOT
 * done with it:
 *
 *   • `page_url` is shown as text, never as an `<a href>`. A form that can put
 *     a clickable link in front of a platform administrator is a phishing
 *     vector aimed at ourselves.
 *   • Nothing is passed to `dangerouslySetInnerHTML`, ever.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { FilterSelect } from '@/components/ui/filter-select'
import { Pagination } from '@/components/ui/pagination'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, ApiClientError } from '@/lib/fetcher'

export interface SupportRow {
  id: string
  tenant_id: string | null
  tenant_name: string | null
  reporter_name: string | null
  reporter_email: string | null
  category: 'bug' | 'feature' | 'billing' | 'account' | 'other'
  subject: string
  message: string
  page_url: string | null
  user_agent: string | null
  status: 'new' | 'in_progress' | 'resolved'
  resolution_note: string | null
  resolved_at: string | null
  created_at: string
}

const CATEGORY_LABELS: Record<SupportRow['category'], string> = {
  bug: 'Bug',
  feature: 'Feature',
  billing: 'Billing',
  account: 'Account',
  other: 'Other',
}

const STATUS_LABELS: Record<SupportRow['status'], string> = {
  new: 'New',
  in_progress: 'In progress',
  resolved: 'Resolved',
}

export function SupportQueue({
  rows, total, page, perPage,
}: {
  rows: SupportRow[]
  total: number
  page: number
  perPage: number
}) {
  const [open, setOpen] = React.useState<SupportRow | null>(null)

  const columns: Column<SupportRow>[] = [
    {
      key: 'subject',
      header: 'Subject',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.subject}</p>
          <p className="truncate text-xs text-ink-muted">
            {row.reporter_name || row.reporter_email || 'Unknown'}
            {row.tenant_name ? ` · ${row.tenant_name}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (row) => <span className="text-ink-muted">{CATEGORY_LABELS[row.category]}</span>,
    },
    {
      key: 'created',
      header: 'Received',
      cell: (row) => (
        <span className="tabular whitespace-nowrap text-ink-muted">
          {row.created_at.slice(0, 10)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} label={STATUS_LABELS[row.status]} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-[100px]',
      cell: (row) => (
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setOpen(row)}>
            Open
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <FilterSelect
        param="status"
        label="Filter by status"
        className="sm:w-52"
        options={[
          { value: '', label: 'All statuses' },
          { value: 'new', label: 'New' },
          { value: 'in_progress', label: 'In progress' },
          { value: 'resolved', label: 'Resolved' },
        ]}
      />

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={MessageSquare}
            title="Nothing here"
            description="Messages sent from the Support button inside a workspace arrive here."
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <RequestDialog row={open} onClose={() => setOpen(null)} />
    </div>
  )
}

function RequestDialog({ row, onClose }: { row: SupportRow | null; onClose: () => void }) {
  const router = useRouter()
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!row) return
    setNote(row.resolution_note ?? '')
    setError(null)
    setBusy(null)
  }, [row])

  async function move(status: SupportRow['status']) {
    if (!row) return
    setError(null)
    setBusy(status)
    try {
      await apiPatch(`/api/super/support/${row.id}`, {
        status,
        resolutionNote: note.trim() || undefined,
      })
      toast.success(`Marked ${STATUS_LABELS[status].toLowerCase()}`)
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{row?.subject}</DialogTitle>
          <DialogDescription>
            {row ? CATEGORY_LABELS[row.category] : ''} ·{' '}
            {row?.reporter_name || row?.reporter_email || 'Unknown'}
            {row?.tenant_name ? ` · ${row.tenant_name}` : ''}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <FormError message={error} />

          <div className="rounded-lg bg-page px-4 py-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{row?.message}</p>
          </div>

          <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Reply to
              </dt>
              {/*
                A `mailto:` is safe (it cannot navigate the admin to a hostile
                page) and is the one action always wanted on this screen.
              */}
              <dd className="mt-0.5">
                {row?.reporter_email ? (
                  <a className="text-brand-600 hover:underline" href={`mailto:${row.reporter_email}`}>
                    {row.reporter_email}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Page they were on
              </dt>
              {/* Text, never a link. See the header of this file. */}
              <dd className="tabular mt-0.5 break-all">{row?.page_url || '—'}</dd>
            </div>
          </dl>

          <FormField label="Internal note" hint="Only visible here.">
            <Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={!!busy}>
            Close
          </Button>
          {row?.status !== 'in_progress' ? (
            <Button
              variant="secondary"
              loading={busy === 'in_progress'}
              onClick={() => move('in_progress')}
            >
              Mark in progress
            </Button>
          ) : null}
          {row?.status !== 'resolved' ? (
            <Button loading={busy === 'resolved'} onClick={() => move('resolved')}>
              Mark resolved
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
