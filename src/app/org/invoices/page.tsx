import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { CircleCheck, Clock, AlertTriangle } from 'lucide-react'
import { PageHeader, StatCard } from '@/components/ui/patterns'
import { invoiceSummary } from '@/lib/invoice-summary'
import { mailingAddressLines } from '@/lib/geo'
import { formatMoney } from '@/lib/utils'
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
  searchParams: Promise<{ q?: string; status?: string; page?: string; new?: string; employee?: string }>
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

  let query = supabase
    .from('invoices')
    .select('*', { count: 'exact' })
    .order('issue_date', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

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

  const currency = ctx.tenant.defaultCurrency ?? 'USD'

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

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" description="Create, track and print invoices." />
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
      {summary.excluded > 0 ? (
        <p className="-mt-3 text-xs text-ink-muted">
          {summary.excluded} invoice(s) in a currency other than {currency} are left out of these
          totals rather than converted.
        </p>
      ) : null}
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
