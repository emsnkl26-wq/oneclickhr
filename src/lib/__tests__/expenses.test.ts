import { describe, it, expect } from 'vitest'
import { monthRange, totalExpenses, totalPayroll, totalRevenue } from '@/lib/expenses'
import type { Expense } from '@/types/db'

type Row = Pick<Expense, 'amount' | 'currency' | 'category'>

const row = (amount: number, category: Expense['category'], currency = 'USD'): Row => ({
  amount,
  category,
  currency,
})

/**
 * The arithmetic is done in whole cents for the reason the invoice tests give:
 * summing floats drifts, and a category breakdown that disagrees with the total
 * above it by a cent is the kind of bug that costs trust rather than money.
 */
describe('totalExpenses', () => {
  it('sums to the cent', () => {
    const result = totalExpenses([row(0.1, 'other'), row(0.2, 'other')], 'USD')
    expect(result.total).toBe(0.3)
  })

  it('breaks down by category, largest first', () => {
    const result = totalExpenses(
      [row(10, 'software'), row(50, 'rent'), row(5, 'software')],
      'USD'
    )
    expect(result.total).toBe(65)
    expect(result.byCategory).toEqual([
      { category: 'rent', total: 50 },
      { category: 'software', total: 15 },
    ])
  })

  /**
   * The one behaviour worth being loud about. Adding 100 USD to 100 INR gives
   * 200 of nothing — so the row is COUNTED and reported, never converted, and
   * the UI says so rather than showing a number that is quietly wrong.
   */
  it('excludes other currencies instead of converting them', () => {
    const result = totalExpenses([row(100, 'other'), row(100, 'other', 'INR')], 'USD')
    expect(result.total).toBe(100)
    expect(result.excluded).toBe(1)
  })

  it('is zero for nothing, rather than NaN', () => {
    expect(totalExpenses([], 'USD')).toMatchObject({ total: 0, excluded: 0, byCategory: [] })
  })
})

describe('totalPayroll', () => {
  const paid = (amount: number | null, status: string, currency: string | null = 'USD') => ({
    amount,
    status,
    currency,
  })

  /**
   * Only `verified` counts. A `submitted` row is an employee's claim that the
   * money arrived, which nobody has agreed with yet — counting it would let the
   * profit figure move because somebody uploaded a screenshot.
   */
  it('counts verified confirmations only', () => {
    const result = totalPayroll(
      [paid(1000, 'verified'), paid(900, 'submitted'), paid(800, 'pending')],
      'USD'
    )
    expect(result.total).toBe(1000)
  })

  it('skips a verified row with no amount', () => {
    expect(totalPayroll([paid(null, 'verified')], 'USD').total).toBe(0)
  })

  /** Pre-dates the currency column being filled in; the workspace's own is the
   * only reasonable reading. */
  it('treats a null currency as the workspace currency', () => {
    expect(totalPayroll([paid(500, 'verified', null)], 'USD')).toEqual({ total: 500, excluded: 0 })
  })

  it('excludes a foreign currency', () => {
    expect(totalPayroll([paid(500, 'verified', 'INR')], 'USD')).toEqual({ total: 0, excluded: 1 })
  })
})

describe('totalRevenue', () => {
  const inv = (amount_paid: number | null, status = 'sent', currency = 'USD') => ({
    amount_paid,
    status,
    currency,
  })

  /**
   * What was COLLECTED, not what was billed — and every invoice with a payment
   * against it, not only the ones marked `paid`. A part-paid invoice has
   * genuinely brought money in, and a status somebody forgot to set should not
   * make the profit figure wrong in either direction.
   */
  it('counts partial payments on unpaid invoices', () => {
    expect(totalRevenue([inv(250, 'sent'), inv(1000, 'paid')], 'USD').total).toBe(1250)
  })

  it('ignores cancelled invoices and unpaid ones', () => {
    expect(totalRevenue([inv(500, 'cancelled'), inv(0, 'sent'), inv(null, 'draft')], 'USD').total)
      .toBe(0)
  })

  it('excludes a foreign currency', () => {
    expect(totalRevenue([inv(100, 'paid', 'GBP')], 'USD')).toEqual({ total: 0, excluded: 1 })
  })
})

describe('monthRange', () => {
  it('ends on the real last day of the month', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' })
    expect(monthRange('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' })
  })

  it('handles a leap February', () => {
    expect(monthRange('2028-02').to).toBe('2028-02-29')
  })
})
