import 'server-only'

/**
 * Money in, and money still owed — across every invoice a workspace has.
 *
 *   earned    what has actually arrived: a PAID invoice's total, a PARTIALLY
 *             PAID invoice's amount received. This is the cash inflow the
 *             Finance overview counts (by `paid_at`) as "Earned".
 *   pending   what has not: the balance of every invoice that is not marked
 *             paid, drafts included — it is money the org expects to bill and
 *             collect. Cancelled invoices are nobody's money and are left out.
 *   overdue   the part of `pending` whose due date has passed (derived, exactly
 *             as the list's status chip derives it).
 *
 * Summed in whole cents, and only in the workspace's currency: an invoice in
 * another currency is counted in `excluded`, never converted.
 *
 * Runs on the caller's session, so RLS scopes it; `tenant_id` is filtered
 * explicitly as a second lock, as on the Finance page.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { effectiveInvoiceStatus } from '@/components/invoice/invoice-status'
import type { InvoiceStatus } from '@/types/db'

export interface CurrencyTotals {
  currency: string
  earned: number
  paidCount: number
  pending: number
  pendingCount: number
  drafts: number
  overdue: number
  overdueCount: number
  /** Every non-cancelled invoice in this currency. */
  count: number
}

export interface InvoiceSummary extends Omit<CurrencyTotals, 'currency' | 'count'> {
  /** Invoices in any other currency — see `others`. */
  excluded: number
  /**
   * The same totals for every OTHER currency, each in its own money and never
   * converted into the workspace's. Largest first, so the currency with the
   * most invoices leads.
   */
  others: CurrencyTotals[]
}

const PAGE = 1000
const MAX_PAGES = 20
const cents = (value: unknown) => Math.round((Number(value) || 0) * 100)

interface Bucket {
  earned: number
  pending: number
  drafts: number
  overdue: number
  paid: number
  pendingCount: number
  overdueCount: number
  count: number
}

const emptyBucket = (): Bucket => ({
  earned: 0, pending: 0, drafts: 0, overdue: 0, paid: 0, pendingCount: 0, overdueCount: 0, count: 0,
})

function totals(currency: string, b: Bucket): CurrencyTotals {
  return {
    currency,
    earned: b.earned / 100,
    paidCount: b.paid,
    pending: b.pending / 100,
    pendingCount: b.pendingCount,
    drafts: b.drafts / 100,
    overdue: b.overdue / 100,
    overdueCount: b.overdueCount,
    count: b.count,
  }
}

export async function invoiceSummary(
  supabase: SupabaseClient,
  tenantId: string,
  currency: string,
  today: string
): Promise<InvoiceSummary> {
  type Row = {
    status: InvoiceStatus
    total: number
    amount_paid: number
    balance_due: number
    currency: string
    due_date: string | null
  }

  const rows: Row[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from('invoices')
      .select('status, total, amount_paid, balance_due, currency, due_date')
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled')
      .order('id')
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error || !data) break
    rows.push(...(data as Row[]))
    if (data.length < PAGE) break
  }

  // One bucket per currency; a row with no currency belongs to the workspace's.
  const buckets = new Map<string, Bucket>()
  for (const row of rows) {
    const code = row.currency || currency
    let b = buckets.get(code)
    if (!b) {
      b = emptyBucket()
      buckets.set(code, b)
    }
    b.count += 1

    if (row.status === 'paid') {
      // A paid invoice counts its total even if an older row never had
      // `amount_paid` filled in.
      b.earned += cents(row.total)
      b.paid += 1
      continue
    }

    b.earned += cents(row.amount_paid)
    const owed = Math.max(0, cents(row.total) - cents(row.amount_paid))
    if (owed === 0) continue

    b.pending += owed
    b.pendingCount += 1
    if (row.status === 'draft') b.drafts += owed
    if (effectiveInvoiceStatus(row, today) === 'overdue') {
      b.overdue += owed
      b.overdueCount += 1
    }
  }

  const own = totals(currency, buckets.get(currency) ?? emptyBucket())
  const others = Array.from(buckets.entries())
    .filter(([code]) => code !== currency)
    .map(([code, b]) => totals(code, b))
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency))

  return {
    earned: own.earned,
    paidCount: own.paidCount,
    pending: own.pending,
    pendingCount: own.pendingCount,
    drafts: own.drafts,
    overdue: own.overdue,
    overdueCount: own.overdueCount,
    excluded: others.reduce((sum, o) => sum + o.count, 0),
    others,
  }
}
