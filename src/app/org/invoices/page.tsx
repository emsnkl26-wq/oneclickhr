import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { suggestInvoiceNumber } from '@/lib/invoice'
import { InvoiceWorkspace } from './invoice-workspace'
import type { Invoice, InvoiceStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Invoices' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'cancelled']

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

  if (status) query = query.eq('status', status)
  // `bill_to->>name` reaches into the jsonb client record, which is where the
  // name someone would search for actually lives.
  if (search) {
    const term = search.replace(/[(),"*\\]/g, ' ').trim()
    if (term) query = query.or(`invoice_number.ilike.%${term}%,bill_to->>name.ilike.%${term}%`)
  }

  const [{ data: invoices, count }, { data: recentNumbers }] = await Promise.all([
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
  ])

  const suggested = suggestInvoiceNumber((recentNumbers ?? []).map((row) => row.invoice_number))

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
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
