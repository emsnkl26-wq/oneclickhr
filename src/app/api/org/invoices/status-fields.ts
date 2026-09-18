import { z } from 'zod'
import { invoiceSchema, isoDate } from '@/lib/schemas'
import type { InvoiceStatus } from '@/types/db'

/**
 * The invoice status rules the two write routes share.
 *
 * `invoiceSchema` in src/lib/schemas.ts predates `partially_paid` and `paid_at`
 * (039); this extends it here rather than forking a second copy of every other
 * field.
 */
export const invoiceStatusEnum = z.enum([
  'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled',
])

export const invoiceWriteSchema = invoiceSchema.extend({
  status: invoiceStatusEnum.default('draft'),
  paidAt: isoDate.nullable().optional(),
})

/** The body of the quick "mark as …" action on the list. */
export const invoiceStatusSchema = z.object({
  status: invoiceStatusEnum,
  paidAt: isoDate.nullable().optional(),
  /** Only meaningful for `partially_paid`: the running total received. */
  amountPaid: z.coerce.number().min(0).optional(),
})

/**
 * `paid_at` only means something while money has arrived. Moving an invoice
 * back to draft or sent clears it, so the Finance overview cannot count income
 * that was un-marked.
 */
export function resolvePaidAt(
  status: InvoiceStatus,
  requested: string | null | undefined,
  existing: string | null | undefined,
  today: string
): string | null {
  if (status !== 'paid' && status !== 'partially_paid') return null
  return requested || existing || today
}
