import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { suggestInvoiceNumber } from '@/lib/invoice'
import { InvoiceWorkspace } from './invoice-workspace'
import { todayIn } from '@/lib/time'
import { INVOICE_STATUSES } from '@/components/invoice/invoice-status'
import type { Invoice, InvoiceStatus } from '@/types/db'

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
  searchParams: Promise<{ q?: string; status?: string; page?: string }>
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

  const [{ data: invoices, count }, { data: recentNumbers }, { data: company }] =
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
        'org_code, address_line1, address_line2, city, state_province, postal_code, country, company_email, company_phone'
      )
      .eq('id', ctx.tenantId)
      .maybeSingle(),
  ])

  const suggested = suggestInvoiceNumber(
    (recentNumbers ?? []).map((row) => row.invoice_number),
    company?.org_code
  )

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" description="Create, track and print invoices." />
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
        orgAddressLines={[
          company?.address_line1,
          company?.address_line2,
          [company?.city, company?.state_province, company?.postal_code]
            .filter(Boolean)
            .join(', '),
          company?.country,
        ].filter((line): line is string => !!line && line.trim().length > 0)}
        orgEmail={company?.company_email ?? null}
        orgPhone={company?.company_phone ?? null}
        timezone={ctx.tenant.timezone}
        today={today}
      />
    </div>
  )
}
