'use client'

/**
 * Who has confirmed being paid this month, and who has not.
 *
 * EVERY ACTIVE EMPLOYEE IS A ROW, confirmed or not. That is the whole value of
 * the screen: a list of confirmations received answers "what came in", and the
 * question payroll actually has is "who is missing" — which only a list built
 * from the PEOPLE can answer.
 *
 * The org uploads nothing here. Payroll runs in ADP and the employee uploads
 * their own confirmation (026); this screen reads and rules on them.
 */

import * as React from 'react'
import { useProgressRouter } from '@/lib/use-progress-router'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, Download, Search, Wallet, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { MONTH_NAMES } from '@/lib/time'
import { initials, formatMoney } from '@/lib/utils'

export interface EmployeeRow {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
  employee_code: string | null
  designation: string | null
}

export interface ConfirmationRow {
  id: string
  employee_id: string
  month: number
  year: number
  amount: number | string | null
  currency: string | null
  paid_on: string | null
  file_url: string | null
  file_name: string | null
  note: string | null
  status: 'pending' | 'submitted' | 'verified' | 'rejected'
  review_note: string | null
  verified_at: string | null
}

/** An employee joined to their confirmation for the selected month, if any. */
interface Row extends EmployeeRow {
  confirmation: ConfirmationRow | null
}

export function PayrollReview({
  employees, confirmations, month, year,
}: {
  employees: EmployeeRow[]
  confirmations: ConfirmationRow[]
  month: number
  year: number
}) {
  const progressRouter = useProgressRouter()
  const [query, setQuery] = React.useState('')
  const [reviewing, setReviewing] = React.useState<Row | null>(null)

  const byEmployee = React.useMemo(
    () => new Map(confirmations.map((row) => [row.employee_id, row])),
    [confirmations]
  )

  const rows: Row[] = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees
      .filter(
        (person) =>
          !q ||
          [person.full_name, person.email, person.employee_code]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(q))
      )
      .map((person) => ({ ...person, confirmation: byEmployee.get(person.id) ?? null }))
  }, [employees, byEmployee, query])

  const years = React.useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: 6 }, (_, index) => current - index)
  }, [])

  const confirmed = rows.filter((row) => row.confirmation?.status === 'verified').length
  const waiting = rows.filter((row) => row.confirmation?.status === 'submitted').length

  function setPeriod(nextMonth: number, nextYear: number) {
    progressRouter.push(`/org/payroll?month=${nextMonth}&year=${nextYear}`)
  }

  const columns: Column<Row>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-8 shrink-0">
            {row.photo_url ? (
              <AvatarImage src={`/api/files/view?key=${encodeURIComponent(row.photo_url)}`} alt="" />
            ) : null}
            <AvatarFallback>{initials(row.full_name, row.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.full_name || row.email}</p>
            <p className="truncate text-xs text-ink-muted">{row.designation || '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      cell: (row) => <span className="tabular text-ink-muted">{row.employee_code || '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => (
        <span className="tabular block text-right">
          {row.confirmation?.amount != null && row.confirmation.currency
            ? formatMoney(Number(row.confirmation.amount), row.confirmation.currency)
            : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Confirmation',
      cell: (row) => <ConfirmationStatus status={row.confirmation?.status ?? null} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-[190px]',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {row.confirmation?.file_url ? (
            <Button asChild size="sm" variant="ghost">
              <a
                href={`/api/files/view?key=${encodeURIComponent(row.confirmation.file_url)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download />
                View
              </a>
            </Button>
          ) : null}
          {row.confirmation?.status === 'submitted' ? (
            <Button size="sm" onClick={() => setReviewing(row)}>
              Review
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={String(month)}
          onChange={(event) => setPeriod(Number(event.target.value), year)}
          className="sm:w-44"
          aria-label="Month"
        >
          {MONTH_NAMES.map((name, index) => (
            <option key={name} value={index + 1}>{name}</option>
          ))}
        </Select>
        <Select
          value={String(year)}
          onChange={(event) => setPeriod(month, Number(event.target.value))}
          className="sm:w-32"
          aria-label="Year"
        >
          {years.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </Select>

        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search employees"
            aria-label="Search employees"
            className="pl-9"
          />
        </div>

        <p className="tabular shrink-0 text-sm text-ink-muted">
          {confirmed} of {rows.length} confirmed
          {waiting ? ` · ${waiting} to review` : ''}
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Wallet}
            title="No employees"
            description="Add employees and they will appear here each month."
          />
        }
      />

      <ReviewDialog row={reviewing} onClose={() => setReviewing(null)} />
    </div>
  )
}

function ConfirmationStatus({ status }: { status: ConfirmationRow['status'] | null }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-600">
        <CheckCircle2 className="size-4" aria-hidden />
        Confirmed
      </span>
    )
  }
  if (status === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink">
        <Clock className="size-4" aria-hidden />
        Awaiting review
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-danger">
        <XCircle className="size-4" aria-hidden />
        Returned
      </span>
    )
  }
  return <StatusChip status="pending" label="Not uploaded" />
}

function ReviewDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const router = useRouter()
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'verified' | 'rejected' | null>(null)

  React.useEffect(() => {
    if (!row) return
    setNote('')
    setError(null)
    setBusy(null)
  }, [row])

  async function decide(status: 'verified' | 'rejected') {
    if (!row?.confirmation) return
    if (status === 'rejected' && !note.trim()) {
      setError('Tell them what is wrong with it.')
      return
    }

    setError(null)
    setBusy(status)
    try {
      await apiPatch(`/api/org/payments/${row.confirmation.id}`, {
        status,
        note: note.trim() || undefined,
      })
      toast.success(status === 'verified' ? 'Payment confirmed' : 'Sent back to the employee')
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const confirmation = row?.confirmation

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row?.full_name || row?.email}</DialogTitle>
          <DialogDescription>
            {confirmation
              ? `${MONTH_NAMES[confirmation.month - 1]} ${confirmation.year} payment confirmation`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <FormError message={error} />

          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">Amount</dt>
              <dd className="tabular mt-0.5 text-sm">
                {confirmation?.amount != null && confirmation.currency
                  ? formatMoney(Number(confirmation.amount), confirmation.currency)
                  : 'Not stated'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Received on
              </dt>
              <dd className="tabular mt-0.5 text-sm">{confirmation?.paid_on || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Document
              </dt>
              <dd className="mt-0.5 text-sm">
                {confirmation?.file_url ? (
                  <a
                    className="text-brand-600 hover:underline"
                    href={`/api/files/view?key=${encodeURIComponent(confirmation.file_url)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {confirmation.file_name || 'Open'}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          {confirmation?.note ? (
            <div className="rounded-lg bg-page px-3.5 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Their note
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{confirmation.note}</p>
            </div>
          ) : null}

          <FormField
            label="Note"
            hint="Required if you send it back — it is the only thing telling them what to fix."
          >
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy === 'rejected'}
            disabled={busy === 'verified'}
            onClick={() => decide('rejected')}
          >
            Send back
          </Button>
          <Button
            loading={busy === 'verified'}
            disabled={busy === 'rejected'}
            onClick={() => decide('verified')}
          >
            <CheckCircle2 />
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
