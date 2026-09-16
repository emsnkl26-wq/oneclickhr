/**
 * Expense arithmetic and vocabulary, in one place, shared by the page, the
 * dashboard and the API.
 *
 * NO DIRECTIVE AT THE TOP, ON PURPOSE — no `'use client'`, no `server-only`.
 * The workspace form totals a period as you type and the server totals the same
 * period for the dashboard; both import this. Same reasoning as src/lib/geo.ts.
 *
 * MONEY IS IN WHOLE CENTS while it is being added up, for the reason
 * src/lib/invoice.ts already gives: 0.1 + 0.2 is 0.30000000000000004, and a
 * category breakdown that disagrees with the total it sits under by a cent is
 * the kind of bug that costs trust rather than money.
 */

import type { Expense, ExpenseCategory } from '@/types/db'

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  payroll: 'Payroll',
  software: 'Software & subscriptions',
  rent: 'Rent & facilities',
  utilities: 'Utilities',
  travel: 'Travel',
  marketing: 'Marketing',
  equipment: 'Equipment',
  professional_services: 'Professional services',
  taxes: 'Taxes & fees',
  insurance: 'Insurance',
  other: 'Other',
}

export function categoryLabel(category: ExpenseCategory): string {
  return EXPENSE_CATEGORY_LABELS[category] ?? 'Other'
}

const cents = (amount: number) => Math.round(amount * 100)
const fromCents = (value: number) => value / 100

/**
 * What a set of rows costs, in one currency.
 *
 * ROWS IN OTHER CURRENCIES ARE COUNTED, NOT CONVERTED — the count comes back as
 * `excluded` so the caller can say so. Adding 100 USD to 100 INR gives 200 of
 * nothing, and converting would need a rate, a date and a source, any of which
 * being wrong is worse than an honest omission.
 */
export interface ExpenseTotal {
  total: number
  currency: string
  /** Rows left out because they are in some other currency. */
  excluded: number
  byCategory: Array<{ category: ExpenseCategory; total: number }>
}

export function totalExpenses(
  rows: Array<Pick<Expense, 'amount' | 'currency' | 'category'>>,
  currency: string
): ExpenseTotal {
  let total = 0
  let excluded = 0
  const buckets = new Map<ExpenseCategory, number>()

  for (const row of rows) {
    if (row.currency !== currency) {
      excluded += 1
      continue
    }
    const value = cents(Number(row.amount) || 0)
    total += value
    buckets.set(row.category, (buckets.get(row.category) ?? 0) + value)
  }

  return {
    total: fromCents(total),
    currency,
    excluded,
    byCategory: [...buckets.entries()]
      .map(([category, value]) => ({ category, total: fromCents(value) }))
      .sort((a, b) => b.total - a.total),
  }
}

/**
 * Payroll, derived from the payment confirmations that already exist.
 *
 * NOT COPIED INTO `expenses` — see 033's header. A copy can be edited, deleted
 * or miss an update, and then two screens in the same product disagree about
 * what payroll cost with no way to tell which is wrong.
 *
 * Only `verified` rows count. A `submitted` one is an employee's claim that the
 * money arrived, which an admin has not yet agreed with; treating it as spend
 * would let the profit figure move because somebody uploaded a screenshot.
 */
export function totalPayroll(
  confirmations: Array<{ amount: number | null; currency: string | null; status: string }>,
  currency: string
): { total: number; excluded: number } {
  let total = 0
  let excluded = 0

  for (const row of confirmations) {
    if (row.status !== 'verified' || row.amount == null) continue
    // A verified row with no currency predates the column being filled in; the
    // workspace's own currency is the only reasonable reading.
    if (row.currency && row.currency !== currency) {
      excluded += 1
      continue
    }
    total += cents(Number(row.amount) || 0)
  }

  return { total: fromCents(total), excluded }
}

/**
 * Revenue: what has actually been COLLECTED, not what has been billed.
 *
 * `amount_paid` rather than `total`, and every invoice that has any payment
 * against it rather than only the ones marked `paid` — a part-paid invoice has
 * genuinely brought money in, and a `paid` status somebody forgot to set should
 * not make the profit figure wrong in the safe direction either.
 */
export function totalRevenue(
  invoices: Array<{ amount_paid: number | null; currency: string; status: string }>,
  currency: string
): { total: number; excluded: number } {
  let total = 0
  let excluded = 0

  for (const invoice of invoices) {
    if (invoice.status === 'cancelled') continue
    const paid = Number(invoice.amount_paid) || 0
    if (paid <= 0) continue
    if (invoice.currency !== currency) {
      excluded += 1
      continue
    }
    total += cents(paid)
  }

  return { total: fromCents(total), excluded }
}

/** Format money for display. Falls back to a plain number for an unknown code. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

/** First and last day of a `YYYY-MM` month, as ISO dates. */
export function monthRange(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}
