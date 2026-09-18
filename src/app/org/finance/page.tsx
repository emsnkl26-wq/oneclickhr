import type { Metadata } from 'next'
import { TrendingUp, TrendingDown, Scale, Percent } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatCard } from '@/components/ui/patterns'
import { categoryLabel } from '@/lib/expenses'
import { formatMoney } from '@/lib/utils'
import { todayIn } from '@/lib/time'
import type { ExpenseCategory } from '@/types/db'
import {
  RANGE_LABELS, buildSeries, byCategory, percentChange, resolveRange, totalsFor,
  type MoneyRow,
} from './finance-data'
import { RangePicker } from './range-picker'
import { CumulativeNetChart, EarnedSpentChart } from './finance-chart-loader'

export const metadata: Metadata = { title: 'Finance overview' }
export const dynamic = 'force-dynamic'

const PAGE = 1000
const MAX_PAGES = 20

/**
 * Page through a query so a busy workspace is not silently truncated at
 * PostgREST's row cap.
 */
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await run(page * PAGE, page * PAGE + PAGE - 1)
    if (error || !data) break
    out.push(...data)
    if (data.length < PAGE) break
  }
  return out
}

/**
 * What the organization earned against what it spent, over a chosen window.
 *
 *   earned    invoices marked PAID (their total) or PARTIALLY PAID (the amount
 *             received), dated by `paid_at` (039) — when the money arrived, not
 *             when it was billed.
 *   spent     the expense ledger (033) by `spent_on`, plus payroll derived from
 *             VERIFIED payment confirmations (026), dated by `paid_on` or the
 *             first of the pay month.
 *
 * TENANT SCOPE: every query runs on the user's session, so RLS limits it to
 * this workspace; each also filters on `tenant_id` explicitly as a second lock.
 */
export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const today = todayIn(ctx.tenant.timezone)
  const range = resolveRange(await searchParams, today)
  const currency = ctx.tenant.defaultCurrency ?? 'USD'

  const startYear = Number(range.prevFrom.slice(0, 4))
  const endYear = Number(range.to.slice(0, 4))

  const [invoices, expenses, confirmations] = await Promise.all([
    fetchAll<{ total: number; amount_paid: number; currency: string; status: string; paid_at: string }>(
      (a, b) =>
        supabase
          .from('invoices')
          .select('total, amount_paid, currency, status, paid_at')
          .eq('tenant_id', ctx.tenantId)
          .in('status', ['paid', 'partially_paid'])
          .gte('paid_at', range.prevFrom)
          .lte('paid_at', range.to)
          .order('paid_at')
          .range(a, b)
    ),
    fetchAll<{ amount: number; currency: string; spent_on: string; category: ExpenseCategory }>(
      (a, b) =>
        supabase
          .from('expenses')
          .select('amount, currency, spent_on, category')
          .eq('tenant_id', ctx.tenantId)
          .gte('spent_on', range.prevFrom)
          .lte('spent_on', range.to)
          .order('spent_on')
          .range(a, b)
    ),
    fetchAll<{ amount: number | null; currency: string | null; paid_on: string | null; month: number; year: number }>(
      (a, b) =>
        supabase
          .from('payment_confirmations')
          .select('amount, currency, paid_on, month, year')
          .eq('tenant_id', ctx.tenantId)
          .eq('status', 'verified')
          .gte('year', startYear)
          .lte('year', endYear)
          .order('year')
          .order('month')
          .range(a, b)
    ),
  ])

  const rows: MoneyRow[] = [
    ...invoices.map((inv) => ({
      date: inv.paid_at,
      // A paid invoice counts its total even if an older row never had
      // `amount_paid` filled in; a partial one counts only what arrived.
      amount: inv.status === 'paid' ? Number(inv.total) || 0 : Number(inv.amount_paid) || 0,
      currency: inv.currency,
      kind: 'earned' as const,
    })),
    ...expenses.map((exp) => ({
      date: exp.spent_on,
      amount: Number(exp.amount) || 0,
      currency: exp.currency,
      kind: 'expense' as const,
      category: exp.category,
    })),
    ...confirmations
      .filter((pc) => pc.amount != null)
      .map((pc) => ({
        date: pc.paid_on ?? `${pc.year}-${String(pc.month).padStart(2, '0')}-01`,
        amount: Number(pc.amount) || 0,
        currency: pc.currency,
        kind: 'payroll' as const,
      })),
  ]

  const current = totalsFor(rows, range.from, range.to, currency)
  const previous = totalsFor(rows, range.prevFrom, range.prevTo, currency)
  const series = buildSeries(rows, range, currency)
  const categories = byCategory(rows, range.from, range.to, currency)
  const margin = current.earned > 0 ? (current.net / current.earned) * 100 : null

  const money = (value: number) => formatMoney(value, currency)
  const change = (now: number, before: number, goodWhenUp = true) => {
    const pct = percentChange(now, before)
    if (pct === null) return `New this period — nothing in the previous one`
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '•'
    const verdict = pct === 0 ? '' : (pct > 0) === goodWhenUp ? ' — better' : ' — worse'
    return `${arrow} ${Math.abs(pct).toFixed(1)}% vs previous period (${money(before)})${verdict}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance overview"
        description={`Money in from paid invoices against expenses and payroll · ${range.from} to ${range.to}`}
        actions={<RangePicker preset={range.preset} from={range.from} to={range.to} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Earned"
          value={money(current.earned)}
          hint={change(current.earned, previous.earned)}
          icon={TrendingUp}
          tone="emerald"
        />
        <StatCard
          label="Spent"
          value={money(current.spent)}
          hint={change(current.spent, previous.spent, false)}
          icon={TrendingDown}
          tone="orange"
        />
        <StatCard
          label="Net"
          value={money(current.net)}
          hint={change(current.net, previous.net)}
          icon={Scale}
          accent={current.net < 0}
        />
        <StatCard
          label="Net margin"
          value={margin === null ? '—' : `${margin.toFixed(1)}%`}
          hint={`Expenses ${money(current.expenses)} · Payroll ${money(current.payroll)}`}
          icon={Percent}
        />
      </div>

      <section className="card-surface space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Earned vs spent</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {RANGE_LABELS[range.preset]} · {range.granularity === 'day' ? 'daily' : 'monthly'} ·{' '}
            {currency}
          </p>
        </div>
        <EarnedSpentChart data={series} currency={currency} />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card-surface space-y-4 p-5">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Cumulative net</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Running profit across the window — the slope is the growth.
            </p>
          </div>
          <CumulativeNetChart data={series} currency={currency} />
        </section>

        <section className="card-surface space-y-3 p-5">
          <h2 className="text-[15px] font-semibold text-ink">Where the money went</h2>
          {categories.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing spent in this window.</p>
          ) : (
            <ul className="space-y-2">
              {categories.slice(0, 8).map((row) => {
                const share = current.spent > 0 ? (row.total / current.spent) * 100 : 0
                return (
                  <li key={row.category} className="space-y-1">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-ink">
                        {categoryLabel(row.category as ExpenseCategory)}
                      </span>
                      <span className="tabular font-medium text-ink">{money(row.total)}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-page">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.max(2, share)}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {current.excluded + previous.excluded > 0 ? (
        <p className="text-xs text-ink-muted">
          {current.excluded + previous.excluded} record(s) in a currency other than {currency} are
          left out rather than converted.
        </p>
      ) : null}
    </div>
  )
}
