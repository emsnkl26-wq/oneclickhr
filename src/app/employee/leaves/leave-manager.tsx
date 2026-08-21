'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CalendarOff, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Textarea, DateField } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiDelete, ApiClientError } from '@/lib/fetcher'
import { inclusiveDays, formatLocal } from '@/lib/time'
import { truncate } from '@/lib/utils'
import type { LeaveStatus } from '@/types/db'

interface LeaveRow {
  id: string
  start_date: string
  end_date: string
  days: number
  reason: string
  status: LeaveStatus
  decision_note: string | null
  decided_at: string | null
  created_at: string
}

export function LeaveManager({
  leaves, timezone, today,
}: {
  leaves: LeaveRow[]
  timezone: string
  today: string
}) {
  const router = useRouter()
  const [applying, setApplying] = React.useState(false)
  const [withdrawing, setWithdrawing] = React.useState<LeaveRow | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onWithdraw() {
    if (!withdrawing) return
    setBusy(true)
    try {
      await apiDelete(`/api/employee/leaves/${withdrawing.id}`)
      toast.success('Request withdrawn')
      setWithdrawing(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<LeaveRow>[] = [
    {
      key: 'dates',
      header: 'Dates',
      cell: (row) => (
        <span className="tabular whitespace-nowrap font-medium">
          {row.start_date} → {row.end_date}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Days',
      cell: (row) => <span className="tabular">{row.days}</span>,
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
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <div className="space-y-1">
          <StatusChip status={row.status} />
          {row.decision_note ? (
            <p className="max-w-[220px] text-xs text-ink-muted">{row.decision_note}</p>
          ) : null}
        </div>
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
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-14',
      cell: (row) =>
        row.status === 'pending' ? (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Withdraw this request"
            onClick={() => setWithdrawing(row)}
          >
            <Trash2 />
          </Button>
        ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setApplying(true)}>
          <Plus />
          Apply for leave
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={leaves}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={CalendarOff}
            title="No leave requests yet"
            description="Apply for time off and your manager will be notified."
            action={<Button onClick={() => setApplying(true)}>Apply for leave</Button>}
          />
        }
      />

      <ApplyDialog
        open={applying}
        today={today}
        onClose={() => setApplying(false)}
        onApplied={() => {
          setApplying(false)
          router.refresh()
        }}
      />

      <Dialog open={!!withdrawing} onOpenChange={(open) => !open && setWithdrawing(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Withdraw this request?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              Your request for {withdrawing?.start_date} → {withdrawing?.end_date} will be removed.
              You can always apply again.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setWithdrawing(null)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" loading={busy} onClick={onWithdraw}>
              Withdraw
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ApplyDialog({
  open, today, onClose, onApplied,
}: {
  open: boolean
  today: string
  onClose: () => void
  onApplied: () => void
}) {
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setStartDate('')
    setEndDate('')
    setReason('')
    setError(null)
    setFields({})
  }, [open])

  // Same inclusive count the server computes, so the preview cannot mislead.
  const days = startDate && endDate && endDate >= startDate ? inclusiveDays(startDate, endDate) : 0

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/employee/leaves', { startDate, endDate, reason })
      toast.success('Leave request submitted')
      onApplied()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Apply for leave</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="From" error={fields.startDate} required>
                <DateField
                  min={today}
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value)
                    if (endDate && e.target.value > endDate) setEndDate(e.target.value)
                  }}
                  required
                />
              </FormField>
              <FormField label="To" error={fields.endDate} required>
                <DateField
                  min={startDate || today}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </FormField>
            </div>

            {days > 0 ? (
              <p className="rounded-lg bg-page px-3.5 py-2.5 text-[13px]">
                That is <strong className="tabular">{days}</strong>{' '}
                {days === 1 ? 'day' : 'days'} of leave, counting both ends.
              </p>
            ) : null}

            <FormField
              label="Reason"
              error={fields.reason}
              hint="Your manager sees this when deciding."
              required
            >
              <Textarea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Family function out of town"
                required
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
