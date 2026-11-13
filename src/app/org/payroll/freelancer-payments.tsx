import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { formatMoney } from '@/lib/utils'
import { InvoiceStatusChip } from '@/components/invoice/invoice-status'
import { EmptyState } from '@/components/ui/patterns'
import type { InvoiceStatus } from '@/types/db'

export interface FreelancerPaymentRow {
  id: string
  invoiceNumber: string
  /** The freelancer being paid — the linked person, or the invoice's bill-to. */
  name: string
  amount: number
  currency: string
  status: string
  issueDate: string
  paidAt: string | null
}

/**
 * Freelancer payments for the selected month, shown on the payroll screen so
 * employees and freelancers sit in one place (046). Freelancers are paid
 * through freelancer invoices rather than pay confirmations, so each row here is
 * one such invoice — its payee, the amount paid, and where it stands.
 */
export function FreelancerPayments({
  rows,
  month,
  year,
}: {
  rows: FreelancerPaymentRow[]
  month: number
  year: number
}) {
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
    month: 'long',
    timeZone: 'UTC',
  })

  return (
    <section className="card-surface space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Freelancers</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Freelancer payments for {monthName} {year}, from freelancer invoices.
          </p>
        </div>
        <Link
          href="/org/invoices?type=freelancer"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-600 hover:underline"
        >
          Invoices
          <ArrowRight className="size-3.5" />
        </Link>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No freelancer payments this month"
          description="Freelancer invoices issued this month appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-muted">
                <th className="py-2 pr-4 font-medium">Freelancer</th>
                <th className="py-2 pr-4 font-medium">Invoice</th>
                <th className="py-2 pr-4 text-right font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5 pr-4 font-medium text-ink">{row.name}</td>
                  <td className="py-2.5 pr-4 tabular text-ink-muted">{row.invoiceNumber}</td>
                  <td className="py-2.5 pr-4 text-right tabular font-medium text-ink">
                    {formatMoney(row.amount, row.currency)}
                  </td>
                  <td className="py-2.5 pr-4">
                    <InvoiceStatusChip
                      invoice={{ status: row.status as InvoiceStatus, due_date: null }}
                      today={row.paidAt ?? row.issueDate}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
