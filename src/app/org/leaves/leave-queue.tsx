'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, CalendarOff } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import {
  Avatar, AvatarFallback, AvatarImage,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { LinkTabs } from '@/components/ui/link-tabs'
import { SearchField } from '@/components/ui/search-field'
import { Pagination } from '@/components/ui/pagination'
import { FormField } from '@/components/ui/form-field'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { initials, truncate } from '@/lib/utils'
import type { LeaveStatus } from '@/types/db'

export interface LeaveRow {
  id: string
  employee_id: string
  employeeName: string
  employeePhoto: string | null
  start_date: string
  end_date: string
  days: number
  reason: string
  status: LeaveStatus
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

/**
 * `leaves` is ONE page, already filtered to `filter` and `searching` by the
 * database. Nothing in here narrows the list any further — the URL is the
 * filter, so the server never sends rows this screen is not going to show.
 */
export function LeaveQueue({
  leaves, total, page, perPage, filter, pendingCount, searching, timezone,
}: {
  leaves: LeaveRow[]
  total: number
  page: number
  perPage: number
  filter: 'pending' | 'decided' | 'all'
  pendingCount: number
  searching: boolean
  timezone: string
}) {
  const router = useRouter()
  const [decision, setDecision] = React.useState<{
    leave: LeaveRow
    status: 'approved' | 'rejected'
  } | null>(null)
  const [note, setNote] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function submitDecision() {
    if (!decision) return
    setBusy(true)
    try {
      await apiPatch(`/api/org/leaves/${decision.leave.id}`, {
        status: decision.status,
        note: note.trim() || undefined,
      })
      toast.success(`Leave ${decision.status}`)
      setDecision(null)
      setNote('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<LeaveRow>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            {row.employeePhoto ? (
              <AvatarImage
                src={`/api/files/view?key=${encodeURIComponent(row.employeePhoto)}`}
                alt=""
              />
            ) : null}
            <AvatarFallback>{initials(row.employeeName)}</AvatarFallback>
          </Avatar>
          <span className="truncate font-medium">{row.employeeName}</span>
        </div>
      ),
    },
    {
      key: 'dates',
      header: 'Dates',
      cell: (row) => (
        <span className="tabular whitespace-nowrap">
          {row.start_date} → {row.end_date}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Days',
      cell: (row) => <span className="tabular font-medium">{row.days}</span>,
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (row) => (
        <span className="text-ink-muted" title={row.reason}>
          {truncate(row.reason, 60)}
        </span>
      ),
    },
    {
      key: 'applied',
      header: 'Applied',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, timezone, 'd MMM')}
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
      className: 'w-[150px]',
      cell: (row) =>
        row.status === 'pending' ? (
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDecision({ leave: row, status: 'approved' })}
            >
              <Check />
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Reject leave for ${row.employeeName}`}
              onClick={() => setDecision({ leave: row, status: 'rejected' })}
            >
              <X />
            </Button>
          </div>
        ) : (
          <span className="block text-right text-xs text-ink-muted">
            {row.decided_at ? formatLocal(row.decided_at, timezone, 'd MMM') : '—'}
          </span>
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
            { value: 'pending', label: pendingCount ? `Pending (${pendingCount})` : 'Pending' },
            { value: 'decided', label: 'Decided' },
            { value: 'all', label: 'All' },
          ]}
        />

        <SearchField
          param="q"
          placeholder="Search by employee name"
          label="Search leave requests"
          className="sm:max-w-72 sm:flex-none"
        />
      </div>

      <DataTable
        columns={columns}
        rows={leaves}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={CalendarOff}
            title={searching ? 'No matches' : filter === 'pending' ? 'Nothing to review' : 'No leave requests'}
            description={
              searching
                ? 'No requests from anyone by that name.'
                : filter === 'pending'
                  ? 'Requests from your team appear here as soon as they apply.'
                  : 'Nothing matches this filter.'
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <Dialog open={!!decision} onOpenChange={(open) => !open && setDecision(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {decision?.status === 'approved' ? 'Approve' : 'Reject'} leave
            </DialogTitle>
            <DialogDescription>
              {decision?.leave.employeeName} · {decision?.leave.start_date} →{' '}
              {decision?.leave.end_date} ({decision?.leave.days}{' '}
              {decision?.leave.days === 1 ? 'day' : 'days'})
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-4">
            <div className="rounded-lg bg-page p-3 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-ink-muted">
                Their reason
              </p>
              {decision?.leave.reason}
            </div>
            <FormField
              label="Note"
              hint="Included in the email we send them. Optional."
            >
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder={
                  decision?.status === 'approved'
                    ? 'Enjoy your time off.'
                    : 'Let them know why, and what to do next.'
                }
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDecision(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={decision?.status === 'approved' ? 'default' : 'danger'}
              loading={busy}
              onClick={submitDecision}
            >
              {decision?.status === 'approved' ? 'Approve' : 'Reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
