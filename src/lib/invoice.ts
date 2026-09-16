/**
 * Invoice arithmetic, in one place, shared by the form preview and the server.
 *
 * Money is computed in whole cents and only rendered as a decimal, because
 * summing floats drifts: 0.1 + 0.2 is 0.30000000000000004, and a line-item
 * subtotal that disagrees with the printed total by a cent is the kind of bug
 * that costs trust rather than money.
 */
import { invoiceNumberFor } from '@/lib/org-code'
import type { InvoiceItem } from '@/types/db'

export interface InvoiceTotals {
  subtotal: number
  tax: number
  total: number
  balanceDue: number
}

const toCents = (n: number): number => Math.round((Number.isFinite(n) ? n : 0) * 100)
const toAmount = (cents: number): number => Math.round(cents) / 100

/** Line amount = quantity × rate, rounded once at the end. */
export function lineAmount(quantity: number, rate: number): number {
  return toAmount(Math.round(toCents(quantity * rate)))
}

export function computeTotals(
  items: Array<{ quantity: number; rate: number }>,
  taxPercent = 0,
  amountPaid = 0
): InvoiceTotals {
  const subtotalCents = items.reduce(
    (sum, item) => sum + Math.round(toCents(item.quantity * item.rate)),
    0
  )
  const taxCents = Math.round((subtotalCents * (Number.isFinite(taxPercent) ? taxPercent : 0)) / 100)
  const totalCents = subtotalCents + taxCents
  const balanceCents = Math.max(0, totalCents - toCents(amountPaid))

  return {
    subtotal: toAmount(subtotalCents),
    tax: toAmount(taxCents),
    total: toAmount(totalCents),
    balanceDue: toAmount(balanceCents),
  }
}

/** Normalise form input into the `items` jsonb shape stored on the row. */
export function normalizeItems(
  items: Array<{ description: string; quantity: number; rate: number }>
): InvoiceItem[] {
  return items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    rate: item.rate,
    amount: lineAmount(item.quantity, item.rate),
  }))
}

/**
 * Next invoice number in the workspace's series, e.g. `NKL-INV-0008`.
 *
 * Advisory only: the real guarantee is `UNIQUE(tenant_id, invoice_number)`, so
 * two people creating an invoice at the same moment get a conflict rather than
 * a duplicate, and the second one retries with a fresh suggestion.
 *
 * The COUNTER is read from the trailing digits of what already exists, whatever
 * its prefix — so a workspace that adopts an org code mid-year continues at
 * `NKL-INV-0042` after `INV-0041` rather than restarting the count and
 * colliding with an invoice it has already sent.
 */
export function suggestInvoiceNumber(existing: string[], orgCode?: string | null): string {
  let highest = 0
  for (const number of existing) {
    const match = /(\d+)\s*$/.exec(number || '')
    if (match) highest = Math.max(highest, parseInt(match[1], 10))
  }
  return invoiceNumberFor(orgCode, highest + 1)
}
