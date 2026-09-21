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

export interface InvoiceSummary {
  earned: number
  paidCount: number
  pending: number
  pendingCount: number
  drafts: number
  overdue: number
  overdueCount: number
  excluded: number
}

const PAGE = 1000
const MAX_PAGES = 20
const cents = (value: unknown) => Math.round((Number(value) || 0) * 100)

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

  const sum = { earned: 0, pending: 0, drafts: 0, overdue: 0 }
  const count = { paid: 0, pending: 0, overdue: 0, excluded: 0 }

  for (const row of rows) {
    if (row.currency && row.currency !== currency) {
      count.excluded += 1
      continue
    }
    if (row.status === 'paid') {
      // A paid invoice counts its total even if an older row never had
      // `amount_paid` filled in.
      sum.earned += cents(row.total)
      count.paid += 1
      continue
    }

    sum.earned += cents(row.amount_paid)
    const owed = Math.max(0, cents(row.total) - cents(row.amount_paid))
    if (owed === 0) continue

    sum.pending += owed
    count.pending += 1
    if (row.status === 'draft') sum.drafts += owed
    if (effectiveInvoiceStatus(row, today) === 'overdue') {
      sum.overdue += owed
      count.overdue += 1
    }
  }

  return {
    earned: sum.earned / 100,
    paidCount: count.paid,
    pending: sum.pending / 100,
    pendingCount: count.pending,
    drafts: sum.drafts / 100,
    overdue: sum.overdue / 100,
    overdueCount: count.overdue,
    excluded: count.excluded,
  }
}
