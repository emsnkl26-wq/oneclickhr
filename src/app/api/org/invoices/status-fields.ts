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

const blankToNull = (v: unknown) => (v === '' || v === undefined ? null : v)

export const invoiceWriteSchema = invoiceSchema
  .extend({
    status: invoiceStatusEnum.default('draft'),
    paidAt: isoDate.nullable().optional(),
    /*
     * The payout side (043): billed in `currency`, paid to the person in
     * `payoutCurrency`. Internal only — the printed invoice never shows it.
     */
    employeeId: z.preprocess(blankToNull, z.string().uuid().nullable()).optional(),
    vendorId: z.preprocess(blankToNull, z.string().uuid().nullable()).optional(),
    payoutAmount: z
      .preprocess(blankToNull, z.coerce.number().min(0).max(100_000_000).nullable())
      .optional(),
    payoutCurrency: z
      .preprocess(
        blankToNull,
        z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code').nullable()
      )
      .optional(),
    exchangeRate: z
      .preprocess(blankToNull, z.coerce.number().positive('The rate must be above 0').nullable())
      .optional(),
  })
  .refine((v) => v.payoutAmount == null || !!v.payoutCurrency, {
    message: 'Choose the currency the payout is made in',
    path: ['payoutCurrency'],
  })

/** The payout columns as stored, from a parsed write body. */
export function payoutColumns(input: z.infer<typeof invoiceWriteSchema>) {
  const hasPayout = input.payoutAmount != null
  return {
    employee_id: input.employeeId ?? null,
    payout_amount: hasPayout ? input.payoutAmount : null,
    payout_currency: hasPayout ? input.payoutCurrency ?? null : null,
    // A rate only means something between two DIFFERENT currencies.
    exchange_rate:
      hasPayout && input.payoutCurrency !== input.currency ? input.exchangeRate ?? null : null,
  }
}

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
