'use client'

/**
 * Client-side invoice PDF export.
 *
 * Generated in the browser rather than on a server: the invoice is already fully
 * loaded on the page, so rendering it here saves a round trip, avoids running a
 * PDF toolchain in a lambda, and means no invoice data is posted anywhere to be
 * turned into a document.
 *
 * jsPDF is imported dynamically so its ~350KB never lands in the initial bundle
 * for the many people who look at the invoice list and never export one.
 */
import { formatMoney } from '@/lib/utils'
import { loadOrgLogo, ONECLICKHR_URL } from '@/lib/document-pdf'
import type { Invoice } from '@/types/db'

/** `#C41E33` → `[196, 30, 51]`. Falls back to the platform default on a bad value. */
function hexToRgb(hex: string | null | undefined): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec((hex ?? '').trim())
  if (!match) return [196, 30, 51]
  const value = match[1]
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

export interface InvoiceOrgBranding {
  logoUrl: string | null
  primaryColor: string | null
}

export async function downloadInvoicePdf(
  invoice: Invoice,
  orgName: string,
  org?: InvoiceOrgBranding
): Promise<void> {
  const { default: jsPDF } = await import('jspdf')
  const autoTableModule = await import('jspdf-autotable')
  const autoTable = (autoTableModule.default ??
    autoTableModule) as unknown as (doc: unknown, options: Record<string, unknown>) => void
  const logo = await loadOrgLogo(org?.logoUrl ?? null)

  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 48
  const brand = hexToRgb(org?.primaryColor) // the org's own color, not ours
  const muted: [number, number, number] = [107, 114, 128]

  // --- Header --------------------------------------------------------------
  doc.setFillColor(22, 24, 31)
  doc.rect(0, 0, pageWidth, 96, 'F')

  // The org's own logo, never ours — this document is theirs, on their letterhead.
  let titleX = margin
  if (logo) {
    const size = 40
    const ratio = logo.width / logo.height
    const w = ratio >= 1 ? size : size * ratio
    const h = ratio >= 1 ? size / ratio : size
    doc.addImage(logo.dataUrl, logo.format, margin, 28, w, h)
    titleX = margin + size + 14
  }

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(orgName, titleX, 46)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(200, 202, 210)
  doc.text('INVOICE', titleX, 66)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(255, 255, 255)
  doc.text(invoice.invoice_number, pageWidth - margin, 52, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(200, 202, 210)
  doc.text(invoice.status.toUpperCase(), pageWidth - margin, 68, { align: 'right' })

  // --- Parties -------------------------------------------------------------
  let y = 140

  doc.setTextColor(...muted)
  doc.setFontSize(8)
  doc.text('BILL TO', margin, y)
  doc.text('DETAILS', pageWidth / 2 + 20, y)

  y += 16
  doc.setTextColor(26, 28, 35)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text(invoice.bill_to?.name || '—', margin, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...muted)

  let leftY = y + 14
  if (invoice.bill_to?.email) {
    doc.text(invoice.bill_to.email, margin, leftY)
    leftY += 12
  }
  if (invoice.bill_to?.address) {
    for (const line of doc.splitTextToSize(invoice.bill_to.address, 220) as string[]) {
      doc.text(line, margin, leftY)
      leftY += 12
    }
  }

  const detailX = pageWidth / 2 + 20
  let rightY = y
  for (const [label, value] of [
    ['Issue date', invoice.issue_date],
    ['Due date', invoice.due_date || '—'],
    ['Currency', invoice.currency],
  ] as const) {
    doc.setTextColor(...muted)
    doc.text(label, detailX, rightY)
    doc.setTextColor(26, 28, 35)
    doc.text(String(value), pageWidth - margin, rightY, { align: 'right' })
    rightY += 14
  }

  // --- Line items ----------------------------------------------------------
  autoTable(doc, {
    startY: Math.max(leftY, rightY) + 24,
    margin: { left: margin, right: margin },
    head: [['Description', 'Qty', 'Rate', 'Amount']],
    body: (invoice.items ?? []).map((item) => [
      item.description,
      String(item.quantity),
      formatMoney(item.rate, invoice.currency),
      formatMoney(item.amount, invoice.currency),
    ]),
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 8, textColor: [26, 28, 35] },
    headStyles: {
      fillColor: [246, 247, 249],
      textColor: muted,
      fontStyle: 'bold',
      fontSize: 8,
    },
    columnStyles: {
      1: { halign: 'right', cellWidth: 50 },
      2: { halign: 'right', cellWidth: 80 },
      3: { halign: 'right', cellWidth: 90 },
    },
    // A 1px rule under each row, matching the app's table treatment.
    didDrawCell: (data: { row: { index: number }; cursor?: { y: number }; section: string }) => {
      if (data.section !== 'body') return
      doc.setDrawColor(231, 233, 238)
      doc.setLineWidth(0.5)
    },
  })

  // `lastAutoTable` is attached to the doc by the plugin.
  const afterTable =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 400

  // --- Totals --------------------------------------------------------------
  const totalsX = pageWidth - margin - 200
  let ty = afterTable + 24

  const rows: Array<[string, string, boolean]> = [
    ['Subtotal', formatMoney(invoice.subtotal, invoice.currency), false],
    [`Tax (${invoice.tax_percent}%)`, formatMoney(
      Number(invoice.total) - Number(invoice.subtotal),
      invoice.currency
    ), false],
    ['Total', formatMoney(invoice.total, invoice.currency), true],
    ['Amount paid', formatMoney(invoice.amount_paid, invoice.currency), false],
  ]

  doc.setFontSize(9)
  for (const [label, value, bold] of rows) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setTextColor(...(bold ? ([26, 28, 35] as [number, number, number]) : muted))
    doc.text(label, totalsX, ty)
    doc.setTextColor(26, 28, 35)
    doc.text(value, pageWidth - margin, ty, { align: 'right' })
    ty += 16
  }

  doc.setDrawColor(231, 233, 238)
  doc.line(totalsX, ty - 8, pageWidth - margin, ty - 8)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...brand)
  doc.text('Balance due', totalsX, ty + 8)
  doc.text(formatMoney(invoice.balance_due, invoice.currency), pageWidth - margin, ty + 8, {
    align: 'right',
  })

  // --- Notes ---------------------------------------------------------------
  if (invoice.notes) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...muted)
    doc.text('NOTES', margin, ty + 44)
    doc.setFontSize(9)
    doc.setTextColor(26, 28, 35)
    let ny = ty + 58
    for (const line of doc.splitTextToSize(invoice.notes, pageWidth - margin * 2) as string[]) {
      doc.text(line, margin, ny)
      ny += 12
    }
  }

  // --- Footer ----------------------------------------------------------------
  const pageHeight = doc.internal.pageSize.getHeight()
  const footerY = pageHeight - margin + 6
  doc.setDrawColor(231, 233, 238)
  doc.setLineWidth(0.5)
  doc.line(margin, footerY - 12, pageWidth - margin, footerY - 12)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...muted)
  // Clickable — this is the only branding on an invoice that isn't the org's own.
  doc.textWithLink('Powered by OneClickHR', margin, footerY, { url: ONECLICKHR_URL })

  doc.save(`${invoice.invoice_number}.pdf`)
}
