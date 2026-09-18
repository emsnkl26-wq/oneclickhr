/**
 * Invoice status vocabulary, shared by the list, the edit dialog, the API and
 * the Finance overview.
 *
 * NO DIRECTIVE AT THE TOP, ON PURPOSE — the server page derives "overdue" for
 * its filter and the client draws the chip; both import this.
 *
 * OVERDUE IS DERIVED, NOT SCHEDULED. A sent or partially paid invoice whose due
 * date has passed reads as overdue without any job having to flip the stored
 * status. Someone can still store `overdue` by hand, and that is respected.
 */

import { StatusChip } from '@/components/ui/patterns'
import type { InvoiceStatus } from '@/types/db'

export const INVOICE_STATUSES: InvoiceStatus[] = [
  'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled',
]

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

type Tone = 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'brand'

const INVOICE_STATUS_TONES: Record<InvoiceStatus, Tone> = {
  draft: 'neutral',
  sent: 'info',
  partially_paid: 'warning',
  paid: 'success',
  overdue: 'danger',
  cancelled: 'neutral',
}

/** Statuses that are still waiting on money and can therefore fall overdue. */
export const OPEN_STATUSES: InvoiceStatus[] = ['sent', 'partially_paid']

/** What the invoice IS today, given its stored status and due date. */
export function effectiveInvoiceStatus(
  invoice: { status: InvoiceStatus; due_date: string | null },
  today: string
): InvoiceStatus {
  if (
    OPEN_STATUSES.includes(invoice.status) &&
    invoice.due_date &&
    invoice.due_date < today
  ) {
    return 'overdue'
  }
  return invoice.status
}

export function InvoiceStatusChip({
  invoice, today,
}: {
  invoice: { status: InvoiceStatus; due_date: string | null }
  today: string
}) {
  const status = effectiveInvoiceStatus(invoice, today)
  return (
    <StatusChip
      status={status}
      label={INVOICE_STATUS_LABELS[status] ?? status}
      tone={INVOICE_STATUS_TONES[status] ?? 'neutral'}
    />
  )
}
