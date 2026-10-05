'use client'

/**
 * Monthly salary slips, rendered in the browser.
 *
 * Two layouts (056): rupee and other non-US slips use the Indian table layout
 * below; US-dollar slips use the earnings statement in `payslip-us-pdf.ts`.
 *
 * FONTS
 * -----
 * Calibri cannot be shipped. Carlito is its metric-compatible open-source
 * twin, so lines break where Calibri's would. Carlito has no ₹ glyph, so the
 * rupee sign alone is drawn in Noto Sans (see `drawText`). The table itself is
 * set in Helvetica, standing in for the original's Arial. All fonts live in
 * `/public/fonts` and are fetched only when a slip is actually generated.
 */

import type { LogoAsset } from '@/lib/document-pdf'
import { sumLines, type PayslipBreakdown } from '@/lib/payslip-breakdown'

/* --------------------------------------------------------------- Inputs */

export interface PayslipOrg {
  name: string
  logo: LogoAsset | null
  /** Printed small and italic under the company name in the footer. */
  tagline: string
  /** One line, e.g. "8795 Stonehouse Dr, Ellicott City, MD – 21043". */
  address: string
  email: string | null
  website: string | null
  /** "Mail to …" under the table — usually an accounts mailbox. */
  queriesEmail: string | null
  /** Printed in the footer beside the address. */
  phone?: string | null
}

export type SalaryBasis = 'annual' | 'monthly'

export interface PayslipInput {
  org: PayslipOrg
  employeeName: string
  employeeEmail: string
  designation: string
  basis: SalaryBasis
  /** Annual or monthly, per `basis`. */
  salary: number
  currency: string
  workingDays: number
  month: number
  year: number
  /** The month's earnings before deductions. */
  earnings: number
  deductions: number
  /**
   * The itemised slip (Basic, HRA, PF …). When present the totals are the sums
   * of its lines and `earnings` / `deductions` are ignored.
   */
  breakdown?: PayslipBreakdown | null
}

/* ------------------------------------------------------------ Type plumbing */

type Doc = {
  setFont(family: string, style?: string): void
  setFontSize(size: number): void
  setTextColor(r: number, g: number, b: number): void
  setDrawColor(r: number, g: number, b: number): void
  setFillColor(r: number, g: number, b: number): void
  setLineWidth(w: number): void
  text(text: string, x: number, y: number): void
  line(x1: number, y1: number, x2: number, y2: number): void
  rect(x: number, y: number, w: number, h: number, style?: string): void
  link(x: number, y: number, w: number, h: number, options: { url: string }): void
  getTextWidth(text: string): number
  splitTextToSize(text: string, width: number): string[]
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void
  addFileToVFS(name: string, data: string): void
  addFont(file: string, family: string, style: string): void
  output(type: 'blob'): Blob
}

type RGB = [number, number, number]
type Style = 'normal' | 'bold' | 'italic' | 'bolditalic'

const BLACK: RGB = [0, 0, 0]
const LINK: RGB = [5, 99, 193]

const FONT_FILES: Array<[family: string, style: Style, file: string]> = [
  ['Carlito', 'normal', 'Carlito-Regular.ttf'],
  ['Carlito', 'bold', 'Carlito-Bold.ttf'],
  ['Carlito', 'italic', 'Carlito-Italic.ttf'],
  ['Carlito', 'bolditalic', 'Carlito-BoldItalic.ttf'],
  ['Noto', 'normal', 'NotoSans-Regular.ttf'],
  ['Noto', 'bolditalic', 'NotoSans-BoldItalic.ttf'],
]

/** The rupee sign falls back to Noto; bold rupees use the regular cut. */
const NOTO_STYLE: Record<Style, Style> = {
  normal: 'normal',
  bold: 'normal',
  italic: 'normal',
  bolditalic: 'bolditalic',
}

let fontCache: Promise<Array<[string, Style, string, string]>> | null = null

function loadFonts() {
  fontCache ??= Promise.all(
    FONT_FILES.map(async ([family, style, file]) => {
      const response = await fetch(`/fonts/${file}`)
      if (!response.ok) throw new Error(`Could not load the ${file} font.`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      return [family, style, file, btoa(binary)] as [string, Style, string, string]
    })
  ).catch((error) => {
    fontCache = null
    throw error
  })
  return fontCache
}

/* --------------------------------------------------------------- Formatting */

export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function daysInMonth(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Money the way the original slips print it. Rupees carry the sign and
 * thousands separators ("₹1,000,000", "₹83,333.33"); every other currency is
 * the bare figure with its code ("1200USD"). `spaced` is the net line's
 * "1200 USD".
 */
export function payslipMoney(
  amount: number,
  currency: string,
  { cents = true, spaced = false }: { cents?: boolean; spaced?: boolean } = {}
): string {
  const code = currency.toUpperCase()
  if (code === 'INR') {
    return (
      '₹' +
      amount.toLocaleString('en-US', {
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: 2,
      })
    )
  }
  const figure = Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
  return `${figure}${spaced ? ' ' : ''}${code}`
}

/* ------------------------------------------------------------------ Drawing */

function setStyle(doc: Doc, style: Style, size: number, color: RGB) {
  doc.setFont('Carlito', style)
  doc.setFontSize(size)
  doc.setTextColor(...color)
}

/** Split into runs so the ₹ sign can be drawn in the fallback font. */
function runs(text: string): Array<{ text: string; rupee: boolean }> {
  return text
    .split(/(₹)/)
    .filter(Boolean)
    .map((part) => ({ text: part, rupee: part === '₹' }))
}

function measure(doc: Doc, text: string, style: Style): number {
  let width = 0
  for (const run of runs(text)) {
    doc.setFont(run.rupee ? 'Noto' : 'Carlito', run.rupee ? NOTO_STYLE[style] : style)
    width += doc.getTextWidth(run.text)
  }
  doc.setFont('Carlito', style)
  return width
}

/** Draw left-aligned text, returning its width. */
function drawText(doc: Doc, text: string, x: number, y: number, style: Style): number {
  let cursor = x
  for (const run of runs(text)) {
    doc.setFont(run.rupee ? 'Noto' : 'Carlito', run.rupee ? NOTO_STYLE[style] : style)
    doc.text(run.text, cursor, y)
    cursor += doc.getTextWidth(run.text)
  }
  doc.setFont('Carlito', style)
  return cursor - x
}

function drawLink(doc: Doc, text: string, url: string, x: number, y: number, size: number) {
  setStyle(doc, 'normal', size, LINK)
  const width = drawText(doc, text, x, y, 'normal')
  doc.setDrawColor(...LINK)
  doc.setLineWidth(0.6)
  doc.line(x, y + 1.5, x + width, y + 1.5)
  doc.link(x, y - size * 0.8, width, size, { url })
  return width
}

/* ------------------------------------------------------------------ Layout */

/*
 * The Indian slip (056) — a copy of the layout the org issued before this
 * product existed (the Dhatsol "Sukruthi" slip): the logo top-right, a
 * label / bold-value list of the employee's details with the working days on
 * the right of the last line, then ONE bordered three-column table — the
 * month as its title, Gross Salary and its components, the gross carried to
 * the right-hand column, "Less : Deduction" and its lines, the deductions
 * carried right, and the net. A short note and the company footer follow.
 *
 * US Letter, in points. Coordinates were measured off the original at
 * 0.643 pt per pixel; change them only against it.
 */
const IN = {
  labelX: 72.6,
  valueX: 166.5,
  detailsTop: 135.7,
  detailsRow: 15.1,
  tableLeft: 70.7,
  col2: 254,
  col3: 366,
  tableRight: 535,
  titleRow: 27,
  firstRow: 22.5,
  row: 16.7,
  carryRow: 23,
}

/** Amounts as the original prints them: "58,200.00" — grouped, two places, no symbol. */
export function tableAmount(amount: number, currency: string): string {
  const locale = currency.toUpperCase() === 'INR' ? 'en-IN' : 'en-US'
  return amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** The month as the title spells it: "November’2024". */
function monthTitle(month: number, year: number): string {
  return `${MONTHS_LONG[month - 1]}’${year}`
}

function helvetica(doc: Doc, style: 'normal' | 'bold', size: number) {
  doc.setFont('helvetica', style)
  doc.setFontSize(size)
  doc.setTextColor(...BLACK)
}

function rightText(doc: Doc, text: string, right: number, y: number) {
  doc.text(text, right - doc.getTextWidth(text), y)
}

interface TableRow {
  label: string
  /** The amount column. */
  mid?: string
  /** The carried-total column. */
  right?: string
  bold?: boolean
  height: number
}

export async function renderPayslip(input: PayslipInput): Promise<Blob> {
  const [{ default: jsPDF }, fonts] = await Promise.all([import('jspdf'), loadFonts()])
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true }) as unknown as Doc
  for (const [family, style, file, data] of fonts) {
    doc.addFileToVFS(file, data)
    doc.addFont(file, family, style)
  }

  const { org, currency } = input
  const breakdown = input.breakdown ?? null
  const earnings = breakdown ? sumLines(breakdown.earnings) : input.earnings
  const deductions = breakdown ? sumLines(breakdown.deductions) : input.deductions
  const net = Math.round((earnings - deductions) * 100) / 100
  const amount = (value: number) => tableAmount(value, currency)

  /* Logo — top right, as in the original. */
  if (org.logo) {
    const boxW = 175
    const boxH = 58
    const ratio = org.logo.width / org.logo.height
    const w = ratio >= boxW / boxH ? boxW : boxH * ratio
    const h = ratio >= boxW / boxH ? boxW / ratio : boxH
    doc.addImage(org.logo.dataUrl, org.logo.format, IN.tableRight - w, 44, w, h)
  }

  /* Employee details: label, then the value in bold. Empty values are left out. */
  const details: Array<[string, string]> = [
    ['Emp Name:', input.employeeName],
    ['Emp ID:', breakdown?.employeeCode ?? ''],
    ['Designation:', input.designation],
    ['Date of Joining:', breakdown?.dateOfJoining ?? ''],
    ['PF No:', breakdown?.pfNumber ?? ''],
    ['Bank Details:', breakdown?.bankDetails ?? ''],
  ]
  const shown = details.filter(([, value]) => value.trim())
  // The last line carries the working days, so there is always at least one.
  if (!shown.length) shown.push(['Emp Name:', input.employeeName || '—'])

  shown.forEach(([label, value], index) => {
    const y = IN.detailsTop + index * IN.detailsRow
    setStyle(doc, 'normal', 11, BLACK)
    drawText(doc, label, IN.labelX, y, 'normal')
    setStyle(doc, 'bold', 11, BLACK)
    drawText(doc, value.trim(), IN.valueX, y, 'bold')
  })

  const lastY = IN.detailsTop + (shown.length - 1) * IN.detailsRow
  const daysValue = `${input.workingDays} days`
  setStyle(doc, 'bold', 11, BLACK)
  const daysWidth = measure(doc, daysValue, 'bold')
  drawText(doc, daysValue, IN.tableRight - daysWidth, lastY, 'bold')
  setStyle(doc, 'normal', 11, BLACK)
  const daysLabel = 'No. of working days: '
  drawText(doc, daysLabel, IN.tableRight - daysWidth - measure(doc, daysLabel, 'normal'), lastY, 'normal')

  /* The table. A simple slip has no components, so it shows one deduction line. */
  const earningItems = breakdown?.earnings ?? []
  const deductionItems = breakdown?.deductions ?? [{ label: 'Deductions', amount: deductions }]
  const rows: TableRow[] = [
    { label: 'Gross Salary', mid: amount(earnings), bold: true, height: IN.firstRow },
    ...earningItems.map((item) => ({ label: item.label, mid: amount(item.amount), height: IN.row })),
    { label: '', right: amount(earnings), bold: true, height: IN.carryRow },
    { label: 'Less : Deduction', bold: true, height: IN.row },
    ...deductionItems.map((item) => ({ label: item.label, mid: amount(item.amount), height: IN.row })),
    { label: '', right: amount(deductions), bold: true, height: IN.carryRow },
    { label: 'Net Salary Payable', right: amount(net), bold: true, height: IN.row },
  ]

  const tableTop = Math.max(221, lastY + 13)
  const bodyTop = tableTop + IN.titleRow
  const tableBottom = bodyTop + rows.reduce((sum, row) => sum + row.height, 0)

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.9)
  doc.rect(IN.tableLeft, tableTop, IN.tableRight - IN.tableLeft, tableBottom - tableTop)
  doc.line(IN.tableLeft, bodyTop, IN.tableRight, bodyTop)
  doc.line(IN.col2, bodyTop, IN.col2, tableBottom)
  doc.line(IN.col3, bodyTop, IN.col3, tableBottom)

  helvetica(doc, 'bold', 9.5)
  const title = `Salary slip for the month of ${monthTitle(input.month, input.year)}`
  doc.text(title, (IN.tableLeft + IN.tableRight) / 2 - doc.getTextWidth(title) / 2, tableTop + IN.titleRow - 6)

  let cursor = bodyTop
  rows.forEach((row, index) => {
    if (index) doc.line(IN.tableLeft, cursor, IN.tableRight, cursor)
    const baseline = cursor + row.height - 4.5
    helvetica(doc, row.bold ? 'bold' : 'normal', 9.5)
    if (row.label) doc.text(row.label, IN.tableLeft + 6.5, baseline)
    if (row.mid) rightText(doc, row.mid, IN.col3 - 2, baseline)
    if (row.right) rightText(doc, row.right, IN.tableRight - 2, baseline)
    cursor += row.height
  })

  /* The note under the table. */
  let noteY = tableBottom + 25
  setStyle(doc, 'normal', 10, BLACK)
  drawText(
    doc,
    'As applicable based on savings declaration by employee if any questions,',
    IN.tableLeft + 1.5, noteY, 'normal'
  )
  if (org.queriesEmail) {
    noteY += 13.5
    const width = drawText(doc, 'Mail to ', IN.tableLeft + 1.5, noteY, 'normal')
    drawLink(doc, org.queriesEmail, `mailto:${org.queriesEmail}`, IN.tableLeft + 1.5 + width, noteY, 10)
  }
  noteY += 15
  setStyle(doc, 'bold', 10, BLACK)
  drawText(doc, 'Note: This is system generated mail. Signature not required.', IN.tableLeft + 1.5, noteY, 'bold')

  /* Footer — company name, a full-width rule, then the address block. */
  const centre = 306
  if (org.tagline) {
    setStyle(doc, 'italic', 8, BLACK)
    centered(doc, org.tagline, centre, 727, 'italic')
  }
  setStyle(doc, 'bold', 12, BLACK)
  centered(doc, org.name.toUpperCase(), centre, 739, 'bold')
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.6)
  doc.line(0, 745, 612, 745)

  const contact = [
    org.phone ? `Phone: ${org.phone}` : '',
    org.website ? `website: ${org.website.replace(/^https?:\/\//i, '')}` : '',
    !org.website && org.email ? `email: ${org.email}` : '',
  ].filter(Boolean)
  // The address on one line and the phone / website on the next, as printed.
  setStyle(doc, 'normal', 8.5, BLACK)
  const lines = [org.address, contact.join(', ')]
    .filter(Boolean)
    .flatMap((part) => doc.splitTextToSize(part, 470))
    .slice(0, 3)
  lines.forEach((line, index) => centered(doc, line, centre, 756 + index * 9.5, 'normal'))

  return doc.output('blob')
}

function centered(doc: Doc, text: string, centre: number, y: number, style: Style) {
  drawText(doc, text, centre - measure(doc, text, style) / 2, y, style)
}

/** `Payslip-Tushar-Sekharamantri-June-2025.pdf` */
export function payslipFileName(employeeName: string, month: number, year: number): string {
  const slug = employeeName.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee'
  return `Payslip-${slug}-${MONTHS_LONG[month - 1]}-${year}.pdf`
}
