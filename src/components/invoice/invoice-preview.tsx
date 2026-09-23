'use client'

/**
 * What the invoice will look like, while it is being typed.
 *
 * A PICTURE OF THE PDF. The form state is handed to `buildInvoicePdf` — the
 * same function the Download button saves from — and the resulting pages are
 * rasterized with pdf.js. So page breaks, spacing and wording are exactly what
 * the download will contain; nothing is laid out twice.
 *
 * pdf.js (~1.7MB) and jsPDF are imported lazily, and a rebuild is debounced so
 * typing stays smooth. If rendering fails for any reason the HTML approximation
 * below (`InvoiceHtmlPreview`) is shown instead of an empty panel.
 */

import { useEffect, useRef, useState } from 'react'
import {
  computeTotals, invoiceDate, invoiceMoney, invoiceQuantity, invoiceRate, normalizeItems,
  quantityHeading,
} from '@/lib/invoice'
import { buildInvoicePdf, type PrintableInvoice } from '@/lib/invoice-pdf'
import { loadOrgLogo, type LogoAsset } from '@/lib/document-pdf'
import type { InvoiceUnit } from '@/types/db'

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
  subject: string
  paymentDetails: string
  billTo: { name: string; email: string; address: string }
  items: Array<{ description: string; quantity: number; rate: number; unit?: InvoiceUnit }>
}

const lines = (value: string) =>
  value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

/** The form state in the shape the PDF writer prints — including its totals. */
function toPrintable(invoice: PreviewInvoice): PrintableInvoice {
  const items = invoice.items.filter(
    (item) => item.description.trim() || item.quantity || item.rate
  )
  const totals = computeTotals(items, invoice.taxPercent, invoice.amountPaid)
  return {
    invoice_number: invoice.invoiceNumber || '—',
    issue_date: invoice.issueDate,
    due_date: invoice.dueDate || null,
    currency: invoice.currency || 'USD',
    bill_to: { name: invoice.billTo.name, email: invoice.billTo.email, address: invoice.billTo.address },
    subject: invoice.subject.trim() || null,
    items: normalizeItems(items),
    subtotal: totals.subtotal,
    tax_percent: invoice.taxPercent,
    total: totals.total,
    amount_paid: invoice.amountPaid,
    balance_due: totals.balanceDue,
    notes: invoice.notes.trim() || null,
    payment_details: invoice.paymentDetails,
  }
}

type PdfJs = typeof import('unpdf')

export function InvoicePreview({
  org, invoice,
}: {
  org: PreviewOrg
  invoice: PreviewInvoice
}) {
  const pagesRef = useRef<HTMLDivElement>(null)
  const logoRef = useRef<Promise<LogoAsset | null> | null>(null)
  const pdfjsRef = useRef<Promise<PdfJs> | null>(null)
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)

  // A stable key for "did anything printed change" — the effect below rebuilds
  // only then, not on every parent render.
  const printable = toPrintable(invoice)
  const signature = JSON.stringify([printable, org.name, org.addressLines, org.logoKey])

  useEffect(() => {
    if (failed) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        logoRef.current ??= loadOrgLogo(org.logoKey)
        pdfjsRef.current ??= import('unpdf')
        const [logo, unpdf] = await Promise.all([logoRef.current, pdfjsRef.current])

        const doc = await buildInvoicePdf(
          printable,
          org.name,
          { logoUrl: org.logoKey, primaryColor: org.primaryColor, addressLines: org.addressLines },
          logo
        )
        const bytes = new Uint8Array(doc.output('arraybuffer'))
        const pdf = await unpdf.getDocumentProxy(bytes)

        // Render every page off-screen first, then swap them in together, so
        // the panel never flashes empty between keystrokes.
        const canvases: HTMLCanvasElement[] = []
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          const viewport = page.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = 'block h-auto w-full rounded-md border border-line bg-white shadow-sm'
          canvas.setAttribute('aria-label', `Invoice preview, page ${n} of ${pdf.numPages}`)
          const context = canvas.getContext('2d')
          if (!context) throw new Error('No canvas context')
          await page.render({ canvasContext: context, viewport }).promise
          canvases.push(canvas)
        }
        await pdf.destroy()

        if (cancelled || !pagesRef.current) return
        pagesRef.current.replaceChildren(...canvases)
        setReady(true)
      } catch (err) {
        console.warn('[invoice-preview] PDF render failed, using HTML preview', err)
        if (!cancelled) setFailed(true)
      }
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
    // `signature` captures everything printed; `printable` is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, failed])

  if (failed) return <InvoiceHtmlPreview org={org} invoice={invoice} />

  return (
    <div className="relative">
      {!ready ? (
        <div className="aspect-[8.5/11] w-full animate-pulse rounded-md border border-line bg-muted" />
      ) : null}
      <div ref={pagesRef} className="space-y-3" />
    </div>
  )
}

/** Fallback when the PDF cannot be rasterized — the same content, laid out in HTML. */
function InvoiceHtmlPreview({
  org, invoice,
}: {
  org: PreviewOrg
  invoice: PreviewInvoice
}) {
  const totals = computeTotals(invoice.items, invoice.taxPercent, invoice.amountPaid)
  const items = invoice.items.filter(
    (item) => item.description.trim() || item.quantity || item.rate
  )
  const currency = invoice.currency || 'USD'

  const totalRows: Array<[string, number]> = []
  if (invoice.taxPercent > 0) {
    totalRows.push(['SUBTOTAL', totals.subtotal])
    totalRows.push([`TAX (${invoice.taxPercent}%)`, totals.tax])
  }
  totalRows.push(['TOTAL AMOUNT', totals.total])
  if (invoice.amountPaid > 0) {
    totalRows.push(['AMOUNT PAID', invoice.amountPaid])
    totalRows.push(['BALANCE DUE', totals.balanceDue])
  }

  const payment = lines(invoice.paymentDetails)

  return (
    <div className="rounded-lg border border-line bg-white px-5 py-6 font-sans text-[9px] leading-snug text-black shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-h-[3rem]">
          {org.logoKey ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/view?key=${encodeURIComponent(org.logoKey)}`}
              alt=""
              className="h-12 w-auto max-w-[6rem] object-contain"
            />
          ) : null}
        </div>
        <div className="text-right">
          <p className="text-[20px] font-bold leading-none tracking-wide text-neutral-500">
            INVOICE
          </p>
          <div className="mt-3 inline-block text-left">
            <p className="font-bold">INVOICE : {invoice.invoiceNumber || '—'}</p>
            <p className="pl-1">DATE: {invoiceDate(invoice.issueDate) || '—'}</p>
            {invoice.dueDate ? <p className="pl-2">DUE DATE: {invoiceDate(invoice.dueDate)}</p> : null}
          </div>
        </div>
      </div>

      {/* From */}
      <div className="mt-3">
        <p className="font-bold">{org.name}</p>
        {org.addressLines.filter(Boolean).map((line, index) => (
          <p key={index}>{line}</p>
        ))}
      </div>

      {/* To / For */}
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <p className="font-bold">TO:</p>
          <p className="font-bold">{invoice.billTo.name || '—'}</p>
          {lines(invoice.billTo.address).map((line, index) => (
            <p key={index}>{line}</p>
          ))}
          {invoice.billTo.email ? <p>{invoice.billTo.email}</p> : null}
        </div>
        <div>
          {invoice.subject.trim() ? (
            <p className="font-bold uppercase">FOR: {invoice.subject}</p>
          ) : null}
        </div>
      </div>

      {/* Table */}
      <div className="mt-6 px-2">
        <table className="w-full border-collapse border border-black font-bold">
          <thead>
            <tr className="border-b border-t-2 border-black">
              <th className="w-[54%] border-r border-black py-1 text-center">DESCRIPTION</th>
              <th className="w-[16%] border-r border-black py-1 text-center">
                {quantityHeading(items)}
              </th>
              <th className="w-[12%] border-r border-black py-1 text-center">RATE</th>
              <th className="py-1 text-center">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="h-32">
                <td className="border-r border-black text-center font-normal text-neutral-400">
                  Add a line item to see it here
                </td>
                <td className="border-r border-black" />
                <td className="border-r border-black" />
                <td />
              </tr>
            ) : (
              items.map((item, index) => (
                <tr key={index} className="align-top">
                  <td className={`border-r border-black px-2 pb-2 ${index === 0 ? 'pt-5' : 'pt-1'}`}>
                    <span className="whitespace-pre-wrap">{item.description || '—'}</span>
                  </td>
                  <td className={`tabular border-r border-black pb-2 text-center ${index === 0 ? 'pt-5' : 'pt-1'}`}>
                    {invoiceQuantity(item.quantity || 0, item.unit)}
                  </td>
                  <td className={`tabular border-r border-black pb-2 text-center ${index === 0 ? 'pt-5' : 'pt-1'}`}>
                    {invoiceRate(item.rate || 0, currency, item.unit)}
                  </td>
                  <td className={`tabular pb-2 text-center ${index === 0 ? 'pt-5' : 'pt-1'}`}>
                    {invoiceMoney((item.quantity || 0) * (item.rate || 0), currency)}
                  </td>
                </tr>
              ))
            )}
            {/* The tall empty body the printed page has. */}
            <tr className="h-16">
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td className="border-r border-black" />
              <td />
            </tr>
          </tbody>
        </table>

        <div className="flex flex-col items-end">
          {totalRows.map(([label, value]) => (
            <div key={label} className="flex w-full items-stretch justify-end font-bold">
              <span className="self-center pr-3">{label}</span>
              <span className="tabular w-[18%] border border-t-0 border-black py-1 text-center">
                {invoiceMoney(value, currency)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {invoice.notes ? (
        <div className="mt-5">
          <p>NOTES</p>
          <p className="whitespace-pre-wrap">{invoice.notes}</p>
        </div>
      ) : null}

      <div className="mt-6">
        {payment.length ? (
          <div className="mb-4">
            <p>PAYMENT DETAILS</p>
            {payment.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        ) : (
          <p className="mb-4 text-neutral-400">
            No payment details — add your bank details in Settings → Company details.
          </p>
        )}
        <p className="font-bold">Thank you for your business !</p>
        <p className="font-bold">{org.name}</p>
      </div>
    </div>
  )
}
