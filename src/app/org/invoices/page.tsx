import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, ChevronRight, CircleCheck, Clock, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader, StatCard } from '@/components/ui/patterns'
import { invoiceSummary, type CurrencyTotals } from '@/lib/invoice-summary'
import { mailingAddressLines } from '@/lib/geo'
import { cn, formatMoney } from '@/lib/utils'
import { billToAddressText, suggestInvoiceNumber } from '@/lib/invoice'
import { monthServiceDescription } from '@/lib/billing'
import { InvoiceWorkspace, type InvoicePrefill } from './invoice-workspace'
import { todayIn } from '@/lib/time'
import { INVOICE_STATUSES } from '@/components/invoice/invoice-status'
import type { Invoice, InvoiceStatus, RateUnit } from '@/types/db'

export const metadata: Metadata = { title: 'Invoices' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const STATUSES: InvoiceStatus[] = INVOICE_STATUSES

/**
 * Invoices, filtered and paged by the database.
 *
 * The whole row is still selected, because the edit dialog and the PDF need the
 * line items — but for FIFTY rows rather than five hundred. `items` and
 * `bill_to` are jsonb, so this is the difference between a payload that grows
 * with a workspace's entire billing history and one that is bounded.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string
    status?: string
    page?: string
    new?: string
    employee?: string
    currency?: string
  }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const search = params.q?.trim() || ''
  const status = STATUSES.includes(params.status as InvoiceStatus)
    ? (params.status as InvoiceStatus)
    : null
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  const currency = ctx.tenant.defaultCurrency ?? 'USD'

  /*
   * WHICH CURRENCY'S INVOICES. The main list is the workspace's own currency —
   * the one its totals are in. Everything billed in another currency lives in
   * its own view (`?currency=other`, or one code), with totals per currency and
   * never converted: a wrong exchange rate is worse than two honest figures.
   */
  const requested = (params.currency ?? '').trim().toUpperCase()
  const currencyView: string =
    requested === 'OTHER'
      ? 'other'
      : /^[A-Z]{3}$/.test(requested) && requested !== currency
        ? requested
        : 'own'

  let query = supabase
    .from('invoices')
    .select('*', { count: 'exact' })
    .order('issue_date', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (currencyView === 'own') query = query.eq('currency', currency)
  else if (currencyView === 'other') query = query.neq('currency', currency)
  else query = query.eq('currency', currencyView)

  const today = todayIn(ctx.tenant.timezone)

  // OVERDUE IS DERIVED (see invoice-status.tsx): the filter has to match the
  // chip, so it takes the stored `overdue` rows AND every open invoice whose due
  // date has passed. Sent / partially paid then EXCLUDE those, so no row shows
  // under two filters.
  if (status === 'overdue') {
    query = query.or(`status.eq.overdue,and(status.in.(sent,partially_paid),due_date.lt.${today})`)
  } else if (status === 'sent' || status === 'partially_paid') {
    query = query.eq('status', status).or(`due_date.is.null,due_date.gte.${today}`)
  } else if (status) {
    query = query.eq('status', status)
  }
  // `bill_to->>name` reaches into the jsonb client record, which is where the
  // name someone would search for actually lives.
  if (search) {
    const term = search.replace(/[(),"*\\]/g, ' ').trim()
    if (term) query = query.or(`invoice_number.ilike.%${term}%,bill_to->>name.ilike.%${term}%`)
  }

  const [{ data: invoices, count }, { data: recentNumbers }, { data: company }, summary] =
    await Promise.all([
    query,
    // The suggestion needs the highest number in the whole series, not the
    // highest on this page. It stays advisory either way — the real guarantee
    // is UNIQUE(tenant_id, invoice_number), which turns a collision into a
    // retry rather than a duplicate.
    supabase
      .from('invoices')
      .select('invoice_number')
      .order('invoice_number', { ascending: false })
      .limit(20),
    // The letterhead the preview draws, so what somebody sees while typing is
    // the document that will actually be sent.
    supabase
      .from('tenants')
      .select(
        'org_code, address_line1, address_line2, city, state_province, postal_code, country, company_email, company_phone, invoice_payment_details'
      )
      .eq('id', ctx.tenantId)
      .maybeSingle(),
    // Across EVERY invoice, not this page: the totals answer "what have we
    // collected and what are we still owed", whatever the filter shows.
    invoiceSummary(supabase, ctx.tenantId, currency, todayIn(ctx.tenant.timezone)),
  ])

  const prefill =
    params.new === 'employee' && params.employee
      ? await employeePrefill(supabase, params.employee, todayIn(ctx.tenant.timezone))
      : null

  const money = (value: number) => formatMoney(value, currency)

  const suggested = suggestInvoiceNumber(
    (recentNumbers ?? []).map((row) => row.invoice_number),
    company?.org_code
  )

  const inOtherView = currencyView !== 'own'
  const shownOthers =
    currencyView === 'own' || currencyView === 'other'
      ? summary.others
      : summary.others.filter((o) => o.currency === currencyView)

  return (
    <div className="space-y-6">
      <PageHeader
        title={inOtherView ? 'Other currency invoices' : 'Invoices'}
        description={
          inOtherView
            ? `Invoices billed in a currency other than ${currency}. Each currency is totalled on its own — nothing is converted.`
            : 'Create, track and print invoices.'
        }
        actions={
          inOtherView ? (
            <Button asChild variant="secondary">
              <Link href="/org/invoices">
                <ArrowLeft />
                {currency} invoices
              </Link>
            </Button>
          ) : undefined
        }
      />

      {inOtherView ? (
        <>
          {summary.others.length > 1 ? (
            <nav className="flex flex-wrap gap-1.5" aria-label="Currency">
              <CurrencyTab href="/org/invoices?currency=other" active={currencyView === 'other'}>
                All other currencies
              </CurrencyTab>
              {summary.others.map((o) => (
                <CurrencyTab
                  key={o.currency}
                  href={`/org/invoices?currency=${o.currency}`}
                  active={currencyView === o.currency}
                >
                  {o.currency} · {o.count}
                </CurrencyTab>
              ))}
            </nav>
          ) : null}
          {shownOthers.length ? (
            <div className="space-y-3">
              {shownOthers.map((o) => (
                <CurrencySummaryRow key={o.currency} totals={o} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-card px-4 py-3 text-sm text-ink-muted">
              No invoices in another currency.
            </p>
          )}
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Total earned"
              value={money(summary.earned)}
              hint={`${summary.paidCount} invoice${summary.paidCount === 1 ? '' : 's'} marked paid — counted as Earned in Finance`}
              icon={CircleCheck}
              tone="emerald"
            />
            <StatCard
              label="Pending"
              value={money(summary.pending)}
              hint={`${summary.pendingCount} not yet paid${summary.drafts > 0 ? ` · ${money(summary.drafts)} still in draft` : ''}`}
              icon={Clock}
              tone="orange"
            />
            <StatCard
              label="Overdue"
              value={money(summary.overdue)}
              hint={summary.overdueCount ? `${summary.overdueCount} past the due date` : 'Nothing past its due date'}
              icon={AlertTriangle}
              accent={summary.overdue > 0}
            />
          </div>
          {summary.others.length ? (
            <Link
              href="/org/invoices?currency=other"
              className="focus-ring group flex items-center gap-4 rounded-xl border border-line bg-card px-4 py-3.5 shadow-sm transition hover:border-brand-600/40"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <Coins className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Other currency invoices</span>
                <span className="block truncate text-xs text-ink-muted">
                  {summary.excluded} invoice{summary.excluded === 1 ? '' : 's'} in{' '}
                  {summary.others.map((o) => o.currency).join(', ')} — kept out of the {currency}{' '}
                  totals above
                  {summary.others.some((o) => o.pending > 0)
                    ? ` · pending ${summary.others
                        .filter((o) => o.pending > 0)
                        .map((o) => formatMoney(o.pending, o.currency))
                        .join(', ')}`
                    : ''}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-muted transition group-hover:translate-x-0.5" />
            </Link>
          ) : null}
        </>
      )}

      <InvoiceWorkspace
        invoices={(invoices ?? []) as Invoice[]}
        total={count ?? (invoices ?? []).length}
        page={page}
        perPage={PER_PAGE}
        filtered={!!search || !!status}
        suggestedNumber={suggested}
        orgName={ctx.tenant.name}
        orgLogoUrl={ctx.tenant.logoUrl}
        orgPrimaryColor={ctx.tenant.primaryColor}
        orgAddressLines={mailingAddressLines({
          line1: company?.address_line1,
          line2: company?.address_line2,
          city: company?.city,
          state: company?.state_province,
          postalCode: company?.postal_code,
          country: company?.country,
        })}
        orgPaymentDetails={company?.invoice_payment_details ?? null}
        orgEmail={company?.company_email ?? null}
        orgPhone={company?.company_phone ?? null}
        timezone={ctx.tenant.timezone}
        today={today}
        prefill={prefill}
      />
    </div>
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A new invoice for one person, started from their placement — what the
 * employee page's "Generate invoice" opens when there are no approved weeks to
 * bill from.
 *
 * TWO CURRENCIES, on purpose: the vendor is billed in the placement's bill
 * currency (say USD) while the person is paid in its pay currency (say INR).
 * The bill side fills the printed invoice; the pay side fills the internal
 * payout, which the vendor never sees.
 *
 * Covers LAST month, since that is the month that gets billed. Quantity is left
 * at zero rather than guessed — the hours are the one figure a person has to
 * enter.
 */
async function employeePrefill(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  employeeId: string,
  today: string
): Promise<InvoicePrefill | null> {
  if (!UUID.test(employeeId)) return null

  const [{ data: person }, { data: placement }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, designation')
      .eq('id', employeeId)
      .eq('role', 'employee')
      .maybeSingle(),
    supabase
      .from('employee_assignments')
      .select(
        'bill_rate, bill_currency, pay_rate, pay_currency, rate_unit, vendor:vendors(id, name, email, address)'
      )
      .eq('employee_id', employeeId)
      .eq('status', 'active')
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!person) return null

  const row = placement as unknown as {
    bill_rate: number | string | null
    bill_currency: string
    pay_rate: number | string | null
    pay_currency: string
    rate_unit: RateUnit
    vendor: { id: string; name: string; email: string | null; address: Record<string, string> | null } | null
  } | null

  const [y, m] = today.split('-').map(Number)
  const lastMonth = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
  const name = person.full_name || person.email || ''

  return {
    employeeId: person.id,
    employeeName: name,
    vendorId: row?.vendor?.id ?? null,
    billTo: {
      name: row?.vendor?.name ?? '',
      email: row?.vendor?.email ?? '',
      address: billToAddressText(row?.vendor?.address ?? null),
    },
    subject: [person.designation, name].filter(Boolean).join(' - '),
    currency: row?.bill_currency ?? 'USD',
    item: {
      description: monthServiceDescription(person.designation, lastMonth),
      rate: row?.bill_rate == null ? 0 : Number(row.bill_rate),
      unit: row?.rate_unit ?? 'hour',
    },
    payoutCurrency: row?.pay_currency ?? row?.bill_currency ?? 'USD',
    payRate: row?.pay_rate == null ? null : Number(row.pay_rate),
    hasPlacement: !!row,
  }
}

function CurrencyTab({
  href, active, children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'focus-ring rounded-full border px-3 py-1 text-xs font-medium transition',
        active
          ? 'border-transparent bg-brand-600 text-white'
          : 'border-line bg-card text-ink-muted hover:text-ink'
      )}
    >
      {children}
    </Link>
  )
}

/** One currency's earned / pending / overdue, in that currency's own money. */
function CurrencySummaryRow({ totals }: { totals: CurrencyTotals }) {
  const money = (value: number) => formatMoney(value, totals.currency)
  return (
    <div className="rounded-xl border border-line bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <span className="rounded-md bg-page px-2 py-0.5 font-mono text-xs">{totals.currency}</span>
          {totals.count} invoice{totals.count === 1 ? '' : 's'}
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-ink-muted">Earned</dt>
          <dd className="tabular text-lg font-semibold text-emerald-600">{money(totals.earned)}</dd>
          <dd className="text-xs text-ink-muted">{totals.paidCount} paid</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Pending</dt>
          <dd className="tabular text-lg font-semibold">{money(totals.pending)}</dd>
          <dd className="text-xs text-ink-muted">
            {totals.pendingCount} not yet paid
            {totals.drafts > 0 ? ` · ${money(totals.drafts)} in draft` : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Overdue</dt>
          <dd className={cn('tabular text-lg font-semibold', totals.overdue > 0 && 'text-red-600')}>
            {money(totals.overdue)}
          </dd>
          <dd className="text-xs text-ink-muted">
            {totals.overdueCount ? `${totals.overdueCount} past due` : 'Nothing past due'}
          </dd>
        </div>
      </dl>
    </div>
  )
}
