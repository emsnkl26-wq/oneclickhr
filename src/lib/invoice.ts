/**
 * Invoice arithmetic, in one place, shared by the form preview and the server.
 *
 * Money is computed in whole cents and only rendered as a decimal, because
 * summing floats drifts: 0.1 + 0.2 is 0.30000000000000004, and a line-item
 * subtotal that disagrees with the printed total by a cent is the kind of bug
 * that costs trust rather than money.
 */
import { invoiceNumberFor } from '@/lib/org-code'
import type { InvoiceItem, InvoiceUnit } from '@/types/db'

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
  items: Array<{ description: string; quantity: number; rate: number; unit?: InvoiceUnit }>
): InvoiceItem[] {
  return items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    rate: item.rate,
    amount: lineAmount(item.quantity, item.rate),
    ...(item.unit ? { unit: item.unit } : {}),
  }))
}

/* ------------------------------------------------------------ Presentation */
/*
 * How an invoice READS, shared by the PDF writer and the on-screen preview so
 * the document somebody checks while typing is the document that gets sent.
 */

export const INVOICE_UNIT_OPTIONS: Array<{ value: InvoiceUnit; label: string }> = [
  { value: 'hour', label: 'Hours' },
  { value: 'day', label: 'Days' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
  { value: 'item', label: 'Qty' },
]

const UNIT_WORDS: Record<InvoiceUnit, [string, string]> = {
  hour: ['hr', 'hrs'],
  day: ['day', 'days'],
  month: ['month', 'months'],
  year: ['year', 'years'],
  item: ['', ''],
}

const RATE_SUFFIX: Record<InvoiceUnit, string> = {
  hour: '/hr',
  day: '/day',
  month: '/month',
  year: '/year',
  item: '',
}

/**
 * Money as an invoice prints it: `$7,392` for a whole amount, `$7,392.50`
 * otherwise. The trailing `.00` on every figure is noise on a staffing invoice
 * whose hours × rate is almost always whole dollars.
 */
export function invoiceMoney(value: number, currency = 'USD'): string {
  const n = Number.isFinite(value) ? value : 0
  const whole = Math.round(n * 100) % 100 === 0
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    // An unknown or half-typed currency code must not throw mid-keystroke.
    return `${currency} ${n.toFixed(whole ? 0 : 2)}`
  }
}

const trimNumber = (n: number) =>
  Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0'

/** `168 hrs`, `1 hr`, `5 days`, or a bare `3` for a plain quantity. */
export function invoiceQuantity(quantity: number, unit: InvoiceUnit = 'item'): string {
  const [one, many] = UNIT_WORDS[unit] ?? UNIT_WORDS.item
  const word = quantity === 1 ? one : many
  return word ? `${trimNumber(quantity)} ${word}` : trimNumber(quantity)
}

/** `$44/hr`, `$300/day`, or a bare `$500` for a plain quantity. */
export function invoiceRate(rate: number, currency: string, unit: InvoiceUnit = 'item'): string {
  return `${invoiceMoney(rate, currency)}${RATE_SUFFIX[unit] ?? ''}`
}

/** The quantity column's heading: HOURS when every line is hourly, and so on. */
export function quantityHeading(items: Array<{ unit?: InvoiceUnit }>): string {
  const units = new Set(items.map((item) => item.unit ?? 'item'))
  if (units.size !== 1) return 'QTY'
  const [unit] = Array.from(units)
  return unit === 'item' ? 'QTY' : `${UNIT_WORDS[unit][1].replace('hrs', 'hours')}`.toUpperCase()
}

/** `2026-09-11` → `09/11/2026`, the US form the invoice prints. */
export function invoiceDate(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return match ? `${match[2]}/${match[3]}/${match[1]}` : ''
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
