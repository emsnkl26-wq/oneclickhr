'use client'

/**
 * What the invoice will look like, while it is being typed.
 *
 * NOT A PICTURE OF THE PDF — a second rendering of the same numbers. The
 * arithmetic comes from `computeTotals` in src/lib/invoice.ts, which is the
 * exact function the server stores from and the PDF prints from, so the three
 * cannot disagree about a cent. Only the LAYOUT is duplicated here, and layout
 * disagreeing is a cosmetic problem rather than a financial one.
 *
 * Scaled down rather than reflowed: it is recognisably the A4 page somebody is
 * about to send, which is the entire point of showing it. Reflowing it into a
 * "summary card" would answer a different question.
 */

import { computeTotals } from '@/lib/invoice'

export interface PreviewOrg {
  name: string
  logoKey: string | null
  primaryColor: string
  addressLines: string[]
  email: string | null
  phone: string | null
}

export interface PreviewInvoice {
  invoiceNumber: string
  issueDate: string
  dueDate: string
  currency: string
  taxPercent: number
  amountPaid: number
  notes: string
  billTo: { name: string; email: string; address: string }
  items: Array<{ description: string; quantity: number; rate: number }>
}

/** Currency as the invoice will print it, falling back to the bare code. */
function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
    }).format(value)
  } catch {
    // An unknown or half-typed currency code ("US") must not throw mid-keystroke.
    return `${currency} ${value.toFixed(2)}`
  }
}

export function InvoicePreview({
  org, invoice,
}: {
  org: PreviewOrg
  invoice: PreviewInvoice
}) {
  const totals = computeTotals(invoice.items, invoice.taxPercent, invoice.amountPaid)
  const lines = invoice.items.filter(
    (item) => item.description.trim() || item.quantity || item.rate
  )

  return (
    <div className="rounded-lg border border-line bg-white p-6 text-[11px] leading-relaxed text-neutral-900 shadow-sm">
      {/* Letterhead */}
      <div className="flex items-start justify-between gap-6 border-b pb-4"
        style={{ borderColor: org.primaryColor }}
      >
        <div className="min-w-0">
          {org.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/view?key=${encodeURIComponent(org.logoKey)}`}
              alt=""
              className="mb-2 h-8 w-auto max-w-[8rem] object-contain"
            />
          ) : null}
          <p className="text-[13px] font-bold" style={{ color: org.primaryColor }}>
            {org.name}
          </p>
          {org.addressLines.filter(Boolean).map((line, index) => (
            <p key={index} className="text-neutral-600">{line}</p>
          ))}
          {org.email ? <p className="text-neutral-600">{org.email}</p> : null}
          {org.phone ? <p className="text-neutral-600">{org.phone}</p> : null}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[15px] font-bold uppercase tracking-wide" style={{ color: org.primaryColor }}>
            Invoice
          </p>
          <p className="tabular mt-1 font-medium">{invoice.invoiceNumber || '—'}</p>
          <p className="tabular text-neutral-600">
            Issued {invoice.issueDate || '—'}
          </p>
          {invoice.dueDate ? (
            <p className="tabular text-neutral-600">Due {invoice.dueDate}</p>
          ) : null}
        </div>
      </div>

      {/* Bill to */}
      <div className="mt-4">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
          Bill to
        </p>
        <p className="mt-1 font-medium">{invoice.billTo.name || '—'}</p>
        {invoice.billTo.email ? (
          <p className="text-neutral-600">{invoice.billTo.email}</p>
        ) : null}
        {invoice.billTo.address ? (
          <p className="whitespace-pre-wrap text-neutral-600">{invoice.billTo.address}</p>
        ) : null}
      </div>

      {/* Lines */}
      <table className="mt-5 w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-300 text-left text-[9px] uppercase tracking-wider text-neutral-500">
            <th className="pb-1.5 font-semibold">Description</th>
            <th className="pb-1.5 text-right font-semibold">Qty</th>
            <th className="pb-1.5 text-right font-semibold">Rate</th>
            <th className="pb-1.5 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-6 text-center text-neutral-400">
                Add a line item to see it here
              </td>
            </tr>
          ) : (
            lines.map((item, index) => (
              <tr key={index} className="border-b border-neutral-100 align-top">
                <td className="py-1.5 pr-2">{item.description || '—'}</td>
                <td className="tabular py-1.5 text-right">{item.quantity || 0}</td>
                <td className="tabular py-1.5 text-right">
                  {money(item.rate || 0, invoice.currency)}
                </td>
                <td className="tabular py-1.5 text-right">
                  {money((item.quantity || 0) * (item.rate || 0), invoice.currency)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <dl className="w-52 space-y-1">
          <div className="flex justify-between">
            <dt className="text-neutral-600">Subtotal</dt>
            <dd className="tabular">{money(totals.subtotal, invoice.currency)}</dd>
          </div>
          {invoice.taxPercent > 0 ? (
            <div className="flex justify-between">
              <dt className="text-neutral-600">Tax ({invoice.taxPercent}%)</dt>
              <dd className="tabular">{money(totals.tax, invoice.currency)}</dd>
            </div>
          ) : null}
          <div
            className="flex justify-between border-t pt-1 font-bold"
            style={{ borderColor: org.primaryColor }}
          >
            <dt>Total</dt>
            <dd className="tabular">{money(totals.total, invoice.currency)}</dd>
          </div>
          {invoice.amountPaid > 0 ? (
            <>
              <div className="flex justify-between">
                <dt className="text-neutral-600">Paid</dt>
                <dd className="tabular">{money(invoice.amountPaid, invoice.currency)}</dd>
              </div>
              <div className="flex justify-between font-semibold">
                <dt>Balance due</dt>
                <dd className="tabular">{money(totals.balanceDue, invoice.currency)}</dd>
              </div>
            </>
          ) : null}
        </dl>
      </div>

      {invoice.notes ? (
        <div className="mt-5 border-t border-neutral-200 pt-3">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
            Notes
          </p>
          <p className="mt-1 whitespace-pre-wrap text-neutral-600">{invoice.notes}</p>
        </div>
      ) : null}
    </div>
  )
}
