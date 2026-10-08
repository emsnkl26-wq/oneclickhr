import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { monthRange, totalExpenses, totalPayroll, totalRevenue } from '@/lib/expenses'
import { todayIn } from '@/lib/time'
import { ExpensesWorkspace } from './expenses-workspace'
import type { Expense, RecurringExpense } from '@/types/db'

export const metadata: Metadata = { title: 'Expenses' }
export const dynamic = 'force-dynamic'

/**
 * What the organization spends, and what is left over.
 *
 * THE MONTH IS THE UNIT. Spend is a rhythm — rent, salaries, subscriptions all
 * land monthly — so the page is scoped to one month rather than showing an
 * unbounded list that nobody can total in their head. `?month=YYYY-MM` drives
 * it, defaulting to the current month IN THE TENANT'S TIMEZONE, so a workspace
 * in Asia/Kolkata does not spend the last few hours of its month looking at the
 * next one.
 */
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const today = todayIn(ctx.tenant.timezone)
  const requested = (await searchParams).month
  // Validated rather than trusted: a malformed value becomes this month instead
  // of reaching the query as a date range Postgres will refuse.
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(requested ?? '')
    ? (requested as string)
    : today.slice(0, 7)

  const { from, to } = monthRange(month)

  /*
   * BOOK WHAT IS OWED BEFORE TOTALLING IT.
   *
   * An auto expense used to appear in the "Auto expenses" tab the moment it was
   * created and then be missing from the month's total, which read as the stats
   * being broken. They were not: nothing had minted the line. The only thing
   * that ever did was a DAILY JOB on an external scheduler (see 004's header),
   * so if that schedule was not set up — or was paused, or the endpoint failed
   * for a few days — no row was ever written, and because the job only ever
   * does the current month, the gap was permanent.
   *
   * `catch_up_recurring_expenses` is the same insert scoped to this tenant and
   * looped over recent periods. It is idempotent via
   * `expenses_recurring_period_uq`, org-gated, and takes its tenant from the
   * session rather than an argument — so calling it here costs one cheap
   * statement and makes the figures below right whether or not the scheduler
   * ever fired. The scheduled job stays, for the workspace nobody opens.
   *
   * The date is TODAY IN THE TENANT'S ZONE: "the 1st" means the 1st where the
   * org is, not where the database is.
   */
  const { error: catchUpError } = await supabase.rpc('catch_up_recurring_expenses', {
    p_today: today,
  })
  if (catchUpError) {
    // Never fatal. A failure here means the totals may be short by a recurring
    // line, which is strictly better than a page that will not load at all.
    console.error('[org/expenses] recurring catch-up failed', catchUpError)
  }

  const [{ data: expenses }, { data: recurring }, { data: confirmations }, { data: invoices }] =
    await Promise.all([
      supabase
        .from('expenses')
        .select(
          'id, title, description, category, vendor, amount, currency, spent_on, receipt_url, source, recurring_id, created_at'
        )
        .gte('spent_on', from)
        .lte('spent_on', to)
        .order('spent_on', { ascending: false })
        .limit(500),

      supabase
        .from('recurring_expenses')
        .select(
          'id, title, description, category, vendor, amount, currency, day_of_month, start_date, end_date, is_active, created_at'
        )
        .order('is_active', { ascending: false })
        .order('day_of_month'),

      // Payroll is DERIVED, never copied into the ledger — see 033's header.
      supabase
        .from('payment_confirmations')
        .select('amount, currency, status')
        .eq('month', Number(month.slice(5, 7)))
        .eq('year', Number(month.slice(0, 4))),

      // Revenue for the same window, so profit is a subtraction of two figures
      // covering the same days rather than two different questions.
      supabase
        .from('invoices')
        .select('amount_paid, currency, status')
        .gte('issue_date', from)
        .lte('issue_date', to),
    ])

  const currency = ctx.tenant.defaultCurrency ?? 'USD'
  const rows = (expenses ?? []) as Expense[]

  const logged = totalExpenses(rows, currency)
  const payroll = totalPayroll(confirmations ?? [], currency)
  const revenue = totalRevenue(invoices ?? [], currency)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Every cost in one ledger, with the subscriptions that repeat booked automatically."
      />
      <ExpensesWorkspace
        month={month}
        currency={currency}
        timezone={ctx.tenant.timezone}
        expenses={rows}
        recurring={(recurring ?? []) as RecurringExpense[]}
        logged={logged}
        payrollTotal={payroll.total}
        revenueTotal={revenue.total}
        excluded={logged.excluded + payroll.excluded + revenue.excluded}
      />
    </div>
  )
}
