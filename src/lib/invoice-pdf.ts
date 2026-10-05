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
import type { Invoice, InvoiceLayout } from '@/types/db'
import type { jsPDF as JsPDF } from 'jspdf'

/** Everything the printed page reads. A saved row satisfies it; so does the form. */
export type PrintableInvoice = Pick<
  Invoice,
  | 'invoice_number' | 'issue_date' | 'due_date' | 'currency' | 'bill_to' | 'subject'
  | 'items' | 'subtotal' | 'tax_percent' | 'total' | 'amount_paid' | 'balance_due'
  | 'notes' | 'payment_details'
> & {
  /** Which page to draw (056). Absent or 'classic' is the boxed staffing invoice. */
  layout?: InvoiceLayout | null
}

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
  /** Regular hours billed at the ordinary rate. */
  billableHours: number
  /** Approved overtime hours, billed at the overtime rate (049). */
  overtimeHours?: number
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
    useFont(doc, value, opts.bold)
    doc.setFontSize(opts.size ?? 8.5)
    doc.setTextColor(...(opts.color ?? INK))
    doc.text(value, x, y, opts.align ? { align: opts.align } : undefined)
  }

  doc.addPage()
  let y = 56
  text('TIMESHEET SUMMARY', left, y, { bold: true, size: 13 })
  y += 20

  // An OVERTIME column only when some week has any (049); otherwise the page
  // reads exactly as it always has.
  const hasOvertime = rows.some((row) => (row.overtimeHours ?? 0) > 0)
  const cols = hasOvertime
    ? [left, left + 80, right - 260, right - 130, right - 60, right]
    : [left, left + 90, right - 220, right - 90, right]
  const end = cols[cols.length - 1]
  const hoursCol = 3
  const rowHeight = 16
  const round2 = (n: number) => Math.round(n * 100) / 100

  const drawHeader = (at: number) => {
    doc.setDrawColor(...INK)
    doc.setLineWidth(1.2)
    doc.line(cols[0], at, end, at)
    doc.setLineWidth(0.6)
    doc.line(cols[0], at + rowHeight, end, at + rowHeight)
    const labels = hasOvertime
      ? ['WEEK', 'EMPLOYEE', 'PERIOD', 'REGULAR', 'OVERTIME']
      : ['WEEK', 'EMPLOYEE', 'PERIOD', 'HOURS']
    labels.forEach((label, i) => {
      text(label, i >= hoursCol ? cols[i] + 6 : cols[i] + 4, at + 11, { bold: true })
    })
    return at + rowHeight
  }

  y = drawHeader(y)
  let totalHours = 0
  let totalOvertime = 0
  for (const row of rows) {
    if (y + rowHeight > pageHeight - 56) {
      doc.line(cols[0], y, end, y)
      doc.addPage()
      y = drawHeader(56)
    }
    text(row.code, cols[0] + 4, y + 11)
    text(row.employeeName, cols[1] + 4, y + 11)
    text(formatPeriod(row.weekStart, row.weekEnd), cols[2] + 4, y + 11)
    text(String(row.billableHours), cols[hoursCol] + 6, y + 11)
    if (hasOvertime) text(String(row.overtimeHours ?? 0), cols[hoursCol + 1] + 6, y + 11)
    totalHours += Number(row.billableHours) || 0
    totalOvertime += Number(row.overtimeHours) || 0
    y += rowHeight
  }
  doc.setLineWidth(0.6)
  doc.line(cols[0], y, end, y)

  y += 20
  if (hasOvertime) {
    text(`TOTAL REGULAR HOURS: ${round2(totalHours)}`, cols[2] + 4, y, { bold: true })
    text(`TOTAL OVERTIME HOURS: ${round2(totalOvertime)}`, cols[2] + 4, y + 14, { bold: true })
  } else {
    text(`TOTAL BILLABLE HOURS: ${round2(totalHours)}`, cols[hoursCol] + 6, y, { bold: true })
  }
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
  await registerUnicodeFont(doc)
  if (invoice.layout === 'modern') return drawModernInvoice(doc, invoice, orgName, org, logo)
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
    useFont(doc, value, opts.bold)
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
  doc.textWithLink('Powered by OneclickHR', left, pageHeight - 24, { url: ONECLICKHR_URL })

  return doc
}

/* ------------------------------------------------------------ Modern layout */

/** `#F97316` → [249, 115, 22]; anything unreadable falls back to slate. */
function hexToRgb(hex: string | null | undefined): RGB {
  const match = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!match) return [30, 41, 59]
  const n = parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const SLATE_900: RGB = [15, 23, 42]
const SLATE_500: RGB = [100, 116, 139]
const SLATE_200: RGB = [226, 232, 240]
const SLATE_50: RGB = [248, 250, 252]

/**
 * The modern invoice (056) — for invoices written on the Invoices page.
 *
 * No ruled grid. A thin brand-coloured band, the company and a large
 * "Invoice" heading, a row of key facts (issued, due, amount due), the billed
 * party, then line items separated by hairlines, a right-aligned totals stack
 * with the balance due in the brand colour, and notes and payment details in
 * soft panels. Invoices generated from an employee's timesheets keep the
 * classic boxed layout above; `invoices.layout` says which one a row uses.
 */
function drawModernInvoice(
  doc: JsPDF,
  invoice: PrintableInvoice,
  orgName: string,
  org: InvoiceOrgBranding | undefined,
  logo: LogoAsset | null
): JsPDF {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const left = 48
  const right = pageWidth - 48
  const currency = invoice.currency || 'USD'
  const brand = hexToRgb(org?.primaryColor)

  const text = (
    value: string | string[],
    x: number,
    y: number,
    opts: { bold?: boolean; size?: number; color?: RGB; align?: 'left' | 'center' | 'right' } = {}
  ) => {
    useFont(doc, value, opts.bold)
    doc.setFontSize(opts.size ?? 9)
    doc.setTextColor(...(opts.color ?? SLATE_900))
    doc.text(value, x, y, opts.align ? { align: opts.align } : undefined)
  }
  const label = (value: string, x: number, y: number, align: 'left' | 'right' = 'left') =>
    text(value.toUpperCase(), x, y, { bold: true, size: 7, color: SLATE_500, align })

  // --- Brand band ---------------------------------------------------------
  doc.setFillColor(...brand)
  doc.rect(0, 0, pageWidth, 6, 'F')

  // --- Company (left) and title (right) -------------------------------------
  let y = 48
  let companyX = left
  if (logo) {
    const box = 44
    const ratio = logo.width / logo.height
    const w = ratio >= 1 ? box : box * ratio
    const h = ratio >= 1 ? box / ratio : box
    doc.addImage(logo.dataUrl, logo.format, left, y, w, h)
    companyX = left + w + 12
  }
  text(orgName, companyX, y + 14, { bold: true, size: 13 })
  let addressY = y + 14
  for (const line of org?.addressLines ?? []) {
    addressY += 11.5
    text(line, companyX, addressY, { size: 8.5, color: SLATE_500 })
  }

  text('Invoice', right, y + 20, { bold: true, size: 26, align: 'right' })
  text(`#${invoice.invoice_number}`, right, y + 36, { size: 10, color: SLATE_500, align: 'right' })

  // --- Key facts --------------------------------------------------------------
  y = Math.max(addressY, y + 44) + 30
  const balance = Number(invoice.balance_due ?? invoice.total) || 0
  doc.setFillColor(...SLATE_50)
  doc.setDrawColor(...SLATE_200)
  doc.setLineWidth(0.6)
  doc.roundedRect(left, y, right - left, 52, 8, 8, 'FD')
  const factW = (right - left) / 3
  const facts: Array<[string, string, boolean]> = [
    ['Issued', invoiceDate(invoice.issue_date) || '—', false],
    ['Due', invoiceDate(invoice.due_date) || 'On receipt', false],
    ['Amount due', invoiceMoney(balance, currency), true],
  ]
  facts.forEach(([name, value, strong], index) => {
    const x = left + 16 + index * factW
    label(name, x, y + 19)
    text(value, x, y + 37, { bold: true, size: strong ? 14 : 11, color: strong ? brand : SLATE_900 })
  })
  y += 52 + 30

  // --- Billed to / For --------------------------------------------------------
  label('Billed to', left, y)
  let toY = y + 15
  if (invoice.bill_to?.name) text(invoice.bill_to.name, left, toY, { bold: true, size: 10.5 })
  for (const line of linesOf(invoice.bill_to?.address)) {
    for (const wrapped of doc.splitTextToSize(line, 230) as string[]) {
      toY += 12
      text(wrapped, left, toY, { size: 9, color: SLATE_500 })
    }
  }
  if (invoice.bill_to?.email) {
    toY += 12
    text(invoice.bill_to.email, left, toY, { size: 9, color: SLATE_500 })
  }

  let forY = y
  if (invoice.subject) {
    const forX = left + factW * 1.6
    label('For', forX, y)
    const wrapped = doc.splitTextToSize(invoice.subject, right - forX) as string[]
    text(wrapped, forX, y + 15, { bold: true, size: 10 })
    forY = y + 15 + 12 * (wrapped.length - 1)
  }

  // --- Line items ---------------------------------------------------------------
  const items = invoice.items ?? []
  const cols = { desc: left, qty: right - 210, rate: right - 110, amount: right }
  const pageBottom = pageHeight - 64

  const drawHeader = (at: number) => {
    label('Description', cols.desc, at)
    label(quantityHeading(items), cols.qty, at, 'right')
    label('Rate', cols.rate, at, 'right')
    label('Amount', cols.amount, at, 'right')
    doc.setDrawColor(...SLATE_900)
    doc.setLineWidth(0.9)
    doc.line(left, at + 7, right, at + 7)
    return at + 24
  }

  let rowY = drawHeader(Math.max(toY, forY) + 40)
  for (const item of items) {
    const description = doc.splitTextToSize(item.description || '', cols.qty - cols.desc - 70) as string[]
    const height = Math.max(1, description.length) * 12
    if (rowY + height > pageBottom) {
      doc.addPage()
      doc.setFillColor(...brand)
      doc.rect(0, 0, pageWidth, 6, 'F')
      rowY = drawHeader(56)
    }
    text(description, cols.desc, rowY, { size: 9.5 })
    text(invoiceQuantity(Number(item.quantity) || 0, item.unit), cols.qty, rowY, { size: 9.5, color: SLATE_500, align: 'right' })
    text(invoiceRate(Number(item.rate) || 0, currency, item.unit), cols.rate, rowY, { size: 9.5, color: SLATE_500, align: 'right' })
    text(invoiceMoney(Number(item.amount) || 0, currency), cols.amount, rowY, { bold: true, size: 9.5, align: 'right' })
    rowY += height + 6
    doc.setDrawColor(...SLATE_200)
    doc.setLineWidth(0.5)
    doc.line(left, rowY, right, rowY)
    rowY += 16
  }

  // --- Totals -------------------------------------------------------------------
  const total = Number(invoice.total) || 0
  const subtotal = Number(invoice.subtotal) || 0
  const paid = Number(invoice.amount_paid) || 0
  const rows: Array<[string, number]> = [['Subtotal', subtotal]]
  if (Number(invoice.tax_percent) > 0) rows.push([`Tax (${invoice.tax_percent}%)`, total - subtotal])
  rows.push(['Total', total])
  if (paid > 0) rows.push(['Paid', -paid])

  let ty = rowY + 4
  if (ty + rows.length * 18 + 50 > pageHeight - 48) {
    doc.addPage()
    ty = 56
  }
  const labelX = right - 200
  for (const [name, value] of rows) {
    const isTotal = name === 'Total'
    text(name, labelX, ty, { bold: isTotal, size: isTotal ? 10.5 : 9.5, color: isTotal ? SLATE_900 : SLATE_500 })
    text(invoiceMoney(value, currency), right, ty, { bold: isTotal, size: isTotal ? 10.5 : 9.5, align: 'right' })
    ty += 18
  }
  // The figure that matters, in the brand colour.
  doc.setFillColor(...brand)
  doc.roundedRect(labelX - 12, ty - 4, right - labelX + 12, 30, 6, 6, 'F')
  text('Balance due', labelX, ty + 15, { bold: true, size: 10.5, color: [255, 255, 255] })
  text(invoiceMoney(balance, currency), right - 10, ty + 15, { bold: true, size: 12, color: [255, 255, 255], align: 'right' })
  ty += 56

  // --- Notes and payment details -------------------------------------------------
  const payment = linesOf(invoice.payment_details ?? org?.paymentDetails)
  const notes = invoice.notes ? (doc.splitTextToSize(invoice.notes, (right - left) / 2 - 36) as string[]) : []
  const panels: Array<{ title: string; lines: string[] }> = []
  if (payment.length) panels.push({ title: 'Payment details', lines: payment })
  if (notes.length) panels.push({ title: 'Notes', lines: notes })

  if (panels.length) {
    const gap = 14
    const width = panels.length === 1 ? right - left : (right - left - gap) / 2
    const height = 30 + Math.max(...panels.map((p) => p.lines.length)) * 12
    if (ty + height > pageHeight - 60) {
      doc.addPage()
      ty = 56
    }
    panels.forEach((panel, index) => {
      const x = left + index * (width + gap)
      doc.setFillColor(...SLATE_50)
      doc.setDrawColor(...SLATE_200)
      doc.roundedRect(x, ty, width, height, 8, 8, 'FD')
      label(panel.title, x + 14, ty + 18)
      panel.lines.forEach((line, i) => text(line, x + 14, ty + 33 + i * 12, { size: 8.5 }))
    })
    ty += height + 28
  }

  if (ty > pageHeight - 70) {
    doc.addPage()
    ty = 56
  }
  text('Thank you for your business.', left, ty, { bold: true, size: 10 })
  text(orgName, left, ty + 13, { size: 9, color: SLATE_500 })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...MUTED)
  doc.textWithLink('Powered by OneclickHR', left, pageHeight - 24, { url: ONECLICKHR_URL })

  return doc
}

/*
 * Helvetica — jsPDF's built-in font — only covers WinAnsi. A rupee sign (and
 * any other symbol outside it) came out as a stray glyph with every following
 * character spaced apart: "¹ 6 , 0 0 0". Noto Sans is embedded and used for
 * any string that needs it; everything else keeps Helvetica.
 */
let notoCache: Promise<string | null> | null = null

function loadNoto(): Promise<string | null> {
  notoCache ??= fetch('/fonts/NotoSans-Regular.ttf')
    .then(async (response) => {
      if (!response.ok) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      return btoa(binary)
    })
    .catch(() => {
      notoCache = null
      return null
    })
  return notoCache
}

const hasUnicodeFont = new WeakSet<JsPDF>()

async function registerUnicodeFont(doc: JsPDF): Promise<void> {
  const data = await loadNoto()
  if (!data) return
  doc.addFileToVFS('NotoSans-Regular.ttf', data)
  doc.addFont('NotoSans-Regular.ttf', 'Noto', 'normal')
  // Bold amounts render in the regular cut; there is no bold Noto shipped.
  doc.addFont('NotoSans-Regular.ttf', 'Noto', 'bold')
  hasUnicodeFont.add(doc)
}

/** Characters WinAnsi (and so Helvetica) can draw beyond Latin-1. */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

function needsUnicode(value: string | string[]): boolean {
  const s = Array.isArray(value) ? value.join('') : value
  for (const ch of s) {
    if (ch.charCodeAt(0) > 0xff && !WIN_ANSI_EXTRA.has(ch)) return true
  }
  return false
}

function useFont(doc: JsPDF, value: string | string[], bold?: boolean) {
  const family = hasUnicodeFont.has(doc) && needsUnicode(value) ? 'Noto' : 'helvetica'
  doc.setFont(family, bold ? 'bold' : 'normal')
}
