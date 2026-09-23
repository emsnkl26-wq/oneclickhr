'use client'

/**
 * Client-side invoice PDF export.
 *
 * Generated in the browser rather than on a server: the invoice is already fully
 * loaded on the page, so rendering it here saves a round trip, avoids running a
 * PDF toolchain in a lambda, and means no invoice data is posted anywhere to be
 * turned into a document.
 *
 * THE LAYOUT is the classic US staffing invoice the orgs already send by hand:
 * logo top-left and a grey INVOICE title top-right with number and dates under
 * it; the org's address; TO: on the left and FOR: beside it; one boxed table of
 * DESCRIPTION / HOURS / RATE / AMOUNT with a tall body; a boxed TOTAL AMOUNT
 * under the amount column; then the bank details and a thank-you. The on-screen
 * preview (src/components/invoice/invoice-preview.tsx) draws the same page, and
 * both read their wording from the helpers in src/lib/invoice.ts.
 *
 * jsPDF is imported dynamically so its ~350KB never lands in the initial bundle
 * for the many people who look at the invoice list and never export one.
 */
import {
  invoiceDate, invoiceMoney, invoiceQuantity, invoiceRate, quantityHeading,
} from '@/lib/invoice'
import { loadOrgLogo, ONECLICKHR_URL, type LogoAsset } from '@/lib/document-pdf'
import { apiGet } from '@/lib/fetcher'
import { formatPeriod } from '@/lib/time'
import type { Invoice } from '@/types/db'
import type { jsPDF as JsPDF } from 'jspdf'

/** Everything the printed page reads. A saved row satisfies it; so does the form. */
export type PrintableInvoice = Pick<
  Invoice,
  | 'invoice_number' | 'issue_date' | 'due_date' | 'currency' | 'bill_to' | 'subject'
  | 'items' | 'subtotal' | 'tax_percent' | 'total' | 'amount_paid' | 'balance_due'
  | 'notes' | 'payment_details'
>

export interface InvoiceOrgBranding {
  logoUrl: string | null
  primaryColor: string | null
  /** The letterhead address, one printed line each. */
  addressLines?: string[]
  /** Printed when the invoice has no payment details of its own (pre-042 rows). */
  paymentDetails?: string | null
}

type RGB = [number, number, number]
const INK: RGB = [0, 0, 0]
const GREY: RGB = [128, 128, 128]
const MUTED: RGB = [120, 120, 120]

/** Split stored text into printed lines: newlines are kept, blanks dropped. */
function linesOf(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** A billed week, as the timesheet summary page prints it. */
export interface TimesheetSummaryRow {
  code: string
  employeeName: string
  weekStart: string
  weekEnd: string
  billableHours: number
}

/**
 * The weeks behind a NORMAL invoice, straight from `timesheets.invoice_id`
 * (024) — nothing here is typed by hand, so there is nothing that can drift
 * from what was actually billed.
 *
 * Failure is swallowed rather than blocking the download: a saved invoice
 * without a reachable summary should still hand over its PDF.
 */
async function fetchTimesheetSummary(invoiceId: string): Promise<TimesheetSummaryRow[]> {
  try {
    const { timesheets } = await apiGet<{ timesheets: TimesheetSummaryRow[] }>(
      `/api/org/invoices/${invoiceId}/timesheets`
    )
    return timesheets
  } catch (err) {
    console.error('[invoice-pdf] could not load the timesheet summary', err)
    return []
  }
}

/** A fresh page listing every billed week, ending with the total hours. */
function appendTimesheetSummaryPage(doc: JsPDF, rows: TimesheetSummaryRow[]): void {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const left = 44
  const right = pageWidth - 44

  const text = (
    value: string,
    x: number,
    y: number,
    opts: { bold?: boolean; size?: number; color?: RGB; align?: 'left' | 'center' | 'right' } = {}
  ) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size ?? 8.5)
    doc.setTextColor(...(opts.color ?? INK))
    doc.text(value, x, y, opts.align ? { align: opts.align } : undefined)
  }

  doc.addPage()
  let y = 56
  text('TIMESHEET SUMMARY', left, y, { bold: true, size: 13 })
  y += 20

  const cols = [left, left + 90, right - 220, right - 90, right]
  const rowHeight = 16

  const drawHeader = (at: number) => {
    doc.setDrawColor(...INK)
    doc.setLineWidth(1.2)
    doc.line(cols[0], at, cols[4], at)
    doc.setLineWidth(0.6)
    doc.line(cols[0], at + rowHeight, cols[4], at + rowHeight)
    const labels = ['WEEK', 'EMPLOYEE', 'PERIOD', 'HOURS']
    labels.forEach((label, i) => {
      text(label, i === 3 ? cols[i] + 6 : cols[i] + 4, at + 11, { bold: true })
    })
    return at + rowHeight
  }

  y = drawHeader(y)
  let totalHours = 0
  for (const row of rows) {
    if (y + rowHeight > pageHeight - 56) {
      doc.line(cols[0], y, cols[4], y)
      doc.addPage()
      y = drawHeader(56)
    }
    text(row.code, cols[0] + 4, y + 11)
    text(row.employeeName, cols[1] + 4, y + 11)
    text(formatPeriod(row.weekStart, row.weekEnd), cols[2] + 4, y + 11)
    text(String(row.billableHours), cols[3] + 6, y + 11)
    totalHours += Number(row.billableHours) || 0
    y += rowHeight
  }
  doc.setLineWidth(0.6)
  doc.line(cols[0], y, cols[4], y)

  y += 20
  text(`TOTAL BILLABLE HOURS: ${totalHours}`, cols[3] + 6, y, { bold: true })
}

export async function downloadInvoicePdf(
  invoice: Invoice,
  orgName: string,
  org?: InvoiceOrgBranding
): Promise<void> {
  const logo = await loadOrgLogo(org?.logoUrl ?? null)
  const doc = await buildInvoicePdf(invoice, orgName, org, logo)

  // A normal invoice is timesheet-backed by definition, so its PDF carries the
  // weeks it was built from — auto-attached, never a separate manual step.
  if (invoice.invoice_type === 'normal' && invoice.id) {
    const timesheets = await fetchTimesheetSummary(invoice.id)
    if (timesheets.length) appendTimesheetSummaryPage(doc, timesheets)
  }

  doc.save(`${invoice.invoice_number}.pdf`)
}

/**
 * Draw the invoice and hand back the document, unsaved.
 *
 * The ONE layout. The download saves what this returns, and the on-screen
 * preview (src/components/invoice/invoice-preview.tsx) rasterizes the very same
 * bytes — so what somebody checks while typing is page-for-page what they get.
 * `logo` is passed in, already loaded, so the preview can fetch it once rather
 * than on every keystroke.
 */
export async function buildInvoicePdf(
  invoice: PrintableInvoice,
  orgName: string,
  org?: InvoiceOrgBranding,
  logo: LogoAsset | null = null
): Promise<JsPDF> {
  const { default: jsPDF } = await import('jspdf')

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const left = 44
  const right = pageWidth - 44
  const currency = invoice.currency || 'USD'

  const text = (
    value: string | string[],
    x: number,
    y: number,
    opts: { bold?: boolean; size?: number; color?: RGB; align?: 'left' | 'center' | 'right' } = {}
  ) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(opts.size ?? 8.5)
    doc.setTextColor(...(opts.color ?? INK))
    doc.text(value, x, y, opts.align ? { align: opts.align } : undefined)
  }

  // --- Header: logo left, INVOICE right ------------------------------------
  const top = 44
  if (logo) {
    const box = 60
    const ratio = logo.width / logo.height
    const w = ratio >= 1 ? box : box * ratio
    const h = ratio >= 1 ? box / ratio : box
    doc.addImage(logo.dataUrl, logo.format, left, top, w, h)
  }

  text('INVOICE', right, top + 22, { bold: true, size: 22, color: GREY, align: 'right' })

  const metaX = pageWidth - 196
  text(`INVOICE : ${invoice.invoice_number}`, metaX, top + 50, { bold: true })
  text(`DATE: ${invoiceDate(invoice.issue_date) || '—'}`, metaX + 4, top + 61)
  if (invoice.due_date) {
    text(`DUE DATE: ${invoiceDate(invoice.due_date)}`, metaX + 8, top + 72)
  }

  // --- From ---------------------------------------------------------------
  let y = top + (logo ? 84 : 50)
  text(orgName, left, y, { bold: true })
  for (const line of org?.addressLines ?? []) {
    y += 11
    text(line, left, y)
  }

  // --- To / For -----------------------------------------------------------
  // With a logo the address sits under it and TO: lines up below both; without
  // one there is nothing to clear, so it simply follows the address.
  const partiesY = logo ? Math.max(y + 40, top + 150) : y + 44
  text('TO:', left, partiesY, { bold: true })
  let toY = partiesY + 11
  if (invoice.bill_to?.name) text(invoice.bill_to.name, left, toY, { bold: true })
  for (const line of linesOf(invoice.bill_to?.address)) {
    for (const wrapped of doc.splitTextToSize(line, 230) as string[]) {
      toY += 11
      text(wrapped, left, toY)
    }
  }
  if (invoice.bill_to?.email) {
    toY += 11
    text(invoice.bill_to.email, left, toY)
  }

  const forX = pageWidth / 2 - 6
  let forY = partiesY
  if (invoice.subject) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    const wrapped = doc.splitTextToSize(`FOR: ${invoice.subject.toUpperCase()}`, right - forX)
    text(wrapped, forX, forY, { bold: true })
    forY += 11 * (wrapped.length - 1)
  }

  // --- The table ------------------------------------------------------------
  const tableLeft = left + 12
  const tableRight = right - 10
  const cols = [tableLeft, tableLeft + 273, tableLeft + 352, tableLeft + 415, tableRight]
  const headerHeight = 16
  const minBody = 172
  const lineHeight = 10.5
  const pageBottom = pageHeight - 56
  const items = invoice.items ?? []
  const qtyHeading = quantityHeading(items)

  /** Header row; returns where the body starts. */
  const drawHeader = (at: number) => {
    doc.setDrawColor(...INK)
    doc.setLineWidth(1.4)
    doc.line(cols[0], at, cols[4], at)
    doc.setLineWidth(0.7)
    doc.line(cols[0], at + headerHeight, cols[4], at + headerHeight)
    const labels = ['DESCRIPTION', qtyHeading, 'RATE', 'AMOUNT']
    labels.forEach((label, i) => {
      text(label, (cols[i] + cols[i + 1]) / 2, at + 11, { bold: true, align: 'center' })
    })
    return at + headerHeight
  }

  /** Close a table segment: outer box and column rules from `from` to `to`. */
  const drawFrame = (from: number, to: number) => {
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.7)
    for (const x of cols) doc.line(x, from, x, to)
    doc.line(cols[0], to, cols[4], to)
  }

  let segmentTop = Math.max(toY, forY) + 64
  let rowY = drawHeader(segmentTop) + 34

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  for (const item of items) {
    const description = doc.splitTextToSize(item.description || '', cols[1] - cols[0] - 16) as string[]
    const height = Math.max(1, description.length) * lineHeight

    if (rowY + height > pageBottom) {
      drawFrame(segmentTop, pageBottom)
      doc.addPage()
      segmentTop = 56
      rowY = drawHeader(segmentTop) + 24
    }

    text(description, cols[0] + 10, rowY, { bold: true })
    text(invoiceQuantity(Number(item.quantity) || 0, item.unit), (cols[1] + cols[2]) / 2, rowY, {
      bold: true, align: 'center',
    })
    text(invoiceRate(Number(item.rate) || 0, currency, item.unit), (cols[2] + cols[3]) / 2, rowY, {
      bold: true, align: 'center',
    })
    text(invoiceMoney(Number(item.amount) || 0, currency), (cols[3] + cols[4]) / 2, rowY, {
      bold: true, align: 'center',
    })
    rowY += height + 14
  }

  const bodyBottom = Math.min(
    Math.max(rowY + 10, segmentTop + headerHeight + minBody),
    pageBottom
  )
  drawFrame(segmentTop, bodyBottom)

  // --- Totals, boxed under the amount column --------------------------------
  const total = Number(invoice.total) || 0
  const subtotal = Number(invoice.subtotal) || 0
  const paid = Number(invoice.amount_paid) || 0
  const rows: Array<[string, number]> = []
  if (Number(invoice.tax_percent) > 0) {
    rows.push(['SUBTOTAL', subtotal])
    rows.push([`TAX (${invoice.tax_percent}%)`, total - subtotal])
  }
  rows.push(['TOTAL AMOUNT', total])
  if (paid > 0) {
    rows.push(['AMOUNT PAID', paid])
    rows.push(['BALANCE DUE', Number(invoice.balance_due) || 0])
  }

  const boxHeight = 18
  const needed = rows.length * boxHeight
  let ty = bodyBottom
  if (ty + needed > pageHeight - 40) {
    doc.addPage()
    ty = 56
  }
  doc.setLineWidth(0.7)
  for (const [label, value] of rows) {
    text(label, cols[3] - 16, ty + 12.5, { bold: true, align: 'right' })
    doc.rect(cols[3], ty, cols[4] - cols[3], boxHeight)
    text(invoiceMoney(value, currency), (cols[3] + cols[4]) / 2, ty + 12.5, {
      bold: true, size: 9, align: 'center',
    })
    ty += boxHeight
  }

  // --- Notes ----------------------------------------------------------------
  let fy = ty + 50
  /** Start a fresh page when `height` more points would run off this one. */
  const ensureRoom = (height: number) => {
    if (fy + height > pageHeight - 40) {
      doc.addPage()
      fy = 56
    }
  }
  if (invoice.notes) {
    ensureRoom(22)
    text('NOTES', left, fy)
    for (const line of doc.splitTextToSize(invoice.notes, right - left) as string[]) {
      ensureRoom(11)
      fy += 11
      text(line, left, fy)
    }
    fy += 24
  }

  // --- Payment details and sign-off ------------------------------------------
  const payment = linesOf(invoice.payment_details ?? org?.paymentDetails)
  if (payment.length) {
    ensureRoom(payment.length * 11.5 + 12)
    text('PAYMENT DETAILS', left, fy)
    for (const line of payment) {
      fy += 11.5
      text(line, left, fy)
    }
    fy += 34
  }

  ensureRoom(12)
  text('Thank you for your business !', left, fy, { bold: true })
  text(orgName, left, fy + 11.5, { bold: true })

  // --- Footer ------------------------------------------------------------------
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...MUTED)
  // Clickable — this is the only branding on an invoice that isn't the org's own.
  doc.textWithLink('Powered by OneClickHR', left, pageHeight - 24, { url: ONECLICKHR_URL })

  return doc
}
