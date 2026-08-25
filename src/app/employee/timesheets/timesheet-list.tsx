'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Timer, Plus, ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/pagination'
import { FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { useProgressRouter } from '@/lib/use-progress-router'
import { addDays, formatPeriod, formatDateLabel } from '@/lib/time'
import { truncate } from '@/lib/utils'
import type { TimesheetStatus } from '@/types/db'

export interface TimesheetRow {
  id: string
  code: string
  week_start: string
  week_end: string
  status: TimesheetStatus
  total_hours: number
  billable_hours: number
  comments: string | null
  attachment_name: string | null
  review_note: string | null
  submitted_at: string | null
  created_at: string
}

export function TimesheetList({
  timesheets, total, page, perPage, currentWeek,
}: {
  timesheets: TimesheetRow[]
  total: number
  page: number
  perPage: number
  /** Sunday of the current week in the org's timezone — where the picker opens. */
  currentWeek: string
}) {
  const [creating, setCreating] = React.useState(false)

  const columns: Column<TimesheetRow>[] = [
    {
      key: 'code',
      header: 'Timesheet ID',
      className: 'w-32',
      cell: (row) => (
        <Link
          href={`/employee/timesheets/${row.id}`}
          className="tabular font-medium text-brand-600 hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      cell: (row) => (
        <span className="tabular whitespace-nowrap font-medium">
          {formatPeriod(row.week_start, row.week_end)}
        </span>
      ),
    },
    {
      key: 'hours',
      header: 'Total hours',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => <span className="tabular font-medium">{Number(row.total_hours)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      key: 'comments',
      header: 'Comments',
      cell: (row) => {
        // A rejection note is the thing the person came here to read, so it wins
        // over their own comment when both exist.
        const text = row.status === 'rejected' && row.review_note ? row.review_note : row.comments
        if (!text) return <span className="text-ink-muted">—</span>
        return (
          <span
            className={row.status === 'rejected' ? 'text-danger' : 'text-ink-muted'}
            title={text}
          >
            {truncate(text, 60)}
          </span>
        )
      },
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New timesheet
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={timesheets}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Timer}
            title="No timesheets yet"
            description="Open a week, fill in your hours and submit it for approval."
            action={<Button onClick={() => setCreating(true)}>Create a timesheet</Button>}
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <NewTimesheetDialog
        open={creating}
        currentWeek={currentWeek}
        onClose={() => setCreating(false)}
      />
    </div>
  )
}

/**
 * Pick a week and open it.
 *
 * A week stepper rather than a date field: the unit of a timesheet is a week, so
 * asking for a date and silently snapping it to the enclosing Sunday would make
 * the control lie about what it accepted. The server normalises anyway — this is
 * about the control saying what it means.
 */
function NewTimesheetDialog({
  open, currentWeek, onClose,
}: {
  open: boolean
  currentWeek: string
  onClose: () => void
}) {
  const router = useRouter()
  const progressRouter = useProgressRouter()
  const [weekStart, setWeekStart] = React.useState(currentWeek)
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setWeekStart(currentWeek)
    setError(null)
  }, [open, currentWeek])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const created = await apiPost<{ id: string }>('/api/timesheets', { weekStart })
      toast.success('Timesheet created')
      onClose()
      router.refresh()
      progressRouter.push(`/employee/timesheets/${created.id}`)
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  const weekEnd = addDays(weekStart, 6)
  const isCurrent = weekStart === currentWeek

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New timesheet</DialogTitle>
            <DialogDescription>Weeks run Sunday to Saturday.</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-page px-3 py-3">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Previous week"
                onClick={() => setWeekStart(addDays(weekStart, -7))}
              >
                <ChevronLeft />
              </Button>

              <div className="min-w-0 text-center">
                <p className="tabular text-sm font-semibold">
                  {formatDateLabel(weekStart)} – {formatDateLabel(weekEnd)}
                </p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {isCurrent ? 'This week' : 'Selected week'}
                </p>
              </div>

              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Next week"
                onClick={() => setWeekStart(addDays(weekStart, 7))}
              >
                <ChevronRight />
              </Button>
            </div>

            {!isCurrent ? (
              <Button type="button" variant="link" onClick={() => setWeekStart(currentWeek)}>
                Back to this week
              </Button>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Open this week
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
