import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { invoiceSummary } from '@/lib/invoice-summary'

/**
 * Invoices in another currency get their own totals (item 4) and are never
 * converted into — or mixed with — the workspace's currency.
 */

/** Just enough of the query builder for invoiceSummary's one select. */
function fakeClient(rows: Array<Record<string, unknown>>): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    order: () => builder,
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
  }
  return { from: () => builder } as unknown as SupabaseClient
}

const row = (over: Record<string, unknown>) => ({
  status: 'sent',
  total: 100,
  amount_paid: 0,
  balance_due: 100,
  currency: 'USD',
  due_date: '2099-01-01',
  ...over,
})

describe('invoiceSummary', () => {
  it('totals the workspace currency and each other currency separately', async () => {
    const summary = await invoiceSummary(
      fakeClient([
        row({ status: 'paid', total: 20, amount_paid: 20 }),
        row({ total: 40 }),
        row({ currency: 'INR', total: 5000 }),
        row({ currency: 'INR', status: 'paid', total: 1000, amount_paid: 1000 }),
        row({ currency: 'EUR', total: 70, due_date: '2020-01-01' }),
      ]),
      't',
      'USD',
      '2026-09-24'
    )

    expect(summary.earned).toBe(20)
    expect(summary.pending).toBe(40)
    expect(summary.excluded).toBe(3)

    const inr = summary.others.find((o) => o.currency === 'INR')!
    expect(inr).toMatchObject({ count: 2, earned: 1000, pending: 5000, paidCount: 1 })

    const eur = summary.others.find((o) => o.currency === 'EUR')!
    expect(eur).toMatchObject({ count: 1, overdue: 70, overdueCount: 1 })

    // Largest group first.
    expect(summary.others[0].currency).toBe('INR')
  })

  it('reports no other currencies when there are none', async () => {
    const summary = await invoiceSummary(fakeClient([row({})]), 't', 'USD', '2026-09-24')
    expect(summary.others).toEqual([])
    expect(summary.excluded).toBe(0)
  })

  it('counts a partial payment as earned and the rest as pending, in whole cents', async () => {
    const summary = await invoiceSummary(
      fakeClient([row({ status: 'partially_paid', total: 100.1, amount_paid: 0.2 })]),
      't',
      'USD',
      '2026-09-24'
    )
    expect(summary.earned).toBe(0.2)
    expect(summary.pending).toBe(99.9)
  })
})
