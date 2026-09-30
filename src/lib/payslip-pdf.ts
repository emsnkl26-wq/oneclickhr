'use client'

/**
 * Monthly salary slips, rendered in the browser.
 *
 * The layout is a point-for-point copy of the slip the org already issues by
 * hand (a Word document exported to PDF): the square logo top-left, a blue
 * title, a six-row details grid, an Earnings and a Deductions table each with a
 * heavy header rule and a grey total row, the italic "Net Salary Payable" line,
 * and the centred company footer. Every coordinate below was measured off that
 * original on a US Letter page, so change them only against it.
 *
 * FONTS
 * -----
 * The original is set in Calibri, which cannot be shipped. Carlito is its
 * metric-compatible open-source twin — same advance widths — so lines break and
 * align exactly where Calibri's would. Carlito has no ₹ glyph, so the rupee sign
 * alone is drawn in Noto Sans (see `drawText`). All fonts live in
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
  /** "For queries, contact: …" — usually an accounts mailbox. */
  queriesEmail: string | null
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
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void
  addFileToVFS(name: string, data: string): void
  addFont(file: string, family: string, style: string): void
  output(type: 'blob'): Blob
}

type RGB = [number, number, number]
type Style = 'normal' | 'bold' | 'italic' | 'bolditalic'

const BLACK: RGB = [0, 0, 0]
/** Word's "Accent 1" blue — the title, section labels and net line. */
const ACCENT: RGB = [79, 129, 189]
const LINK: RGB = [5, 99, 193]
const FILL: RGB = [191, 191, 191]
const FOOTER_RULE: RGB = [160, 160, 160]

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
const MONTHS_SHORT = MONTHS_LONG.map((name) => name.slice(0, 3))

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

// US Letter, in points. Measured off the original slip.
const LEFT = 85.2
const RIGHT = 519.2
const SPLIT = 302.2
const TEXT_X = 90.2
const VALUE_X = 307.3
const ROW = 14.17
const BASELINE = 10.4

function drawGrid(doc: Doc, top: number, rows: Array<[string, string]>) {
  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.75)
  const bottom = top + rows.length * ROW
  doc.rect(LEFT, top, RIGHT - LEFT, bottom - top)
  doc.line(SPLIT, top, SPLIT, bottom)
  rows.forEach(([label, value], index) => {
    const y = top + index * ROW
    if (index) doc.line(LEFT, y, RIGHT, y)
    setStyle(doc, 'normal', 11, BLACK)
    drawText(doc, label, TEXT_X, y + BASELINE, 'normal')
    drawText(doc, value, VALUE_X, y + BASELINE, 'normal')
  })
}

/** Height of one itemised line (Basic, HRA, PF …) inside a section. */
const ITEM_ROW = 14.2

/**
 * "Earnings" / "Deductions": blue label, header row, heavy rule, any itemised
 * lines, then the grey total. Returns the section's bottom edge so the next
 * block can follow it. With no items this draws exactly the original layout.
 */
function drawSection(
  doc: Doc,
  labelBaseline: number,
  label: string,
  items: Array<[string, string]>,
  total: [string, string]
): number {
  setStyle(doc, 'bold', 11, ACCENT)
  drawText(doc, label, TEXT_X, labelBaseline, 'bold')

  const top = labelBaseline + 4.8
  const header = 14.8
  const body = 15.4
  const itemsTop = top + header
  const totalTop = itemsTop + items.length * ITEM_ROW
  const bottom = totalTop + body

  doc.setFillColor(...FILL)
  doc.rect(LEFT, totalTop, RIGHT - LEFT, body, 'F')

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.75)
  doc.rect(LEFT, top, RIGHT - LEFT, bottom - top)
  doc.line(SPLIT, top, SPLIT, bottom)
  items.forEach((_, index) => {
    if (index) doc.line(LEFT, itemsTop + index * ITEM_ROW, RIGHT, itemsTop + index * ITEM_ROW)
  })
  if (items.length) doc.line(LEFT, totalTop, RIGHT, totalTop)
  doc.setLineWidth(2.2)
  doc.line(LEFT, itemsTop, RIGHT, itemsTop)

  setStyle(doc, 'bold', 11, BLACK)
  drawText(doc, 'Description', TEXT_X, top + BASELINE + 0.3, 'bold')
  drawText(doc, 'Amount', VALUE_X, top + BASELINE + 0.3, 'bold')

  setStyle(doc, 'normal', 11, BLACK)
  items.forEach(([name, amount], index) => {
    const baseline = itemsTop + index * ITEM_ROW + BASELINE + 0.8
    drawText(doc, name, TEXT_X, baseline, 'normal')
    drawText(doc, amount, VALUE_X, baseline, 'normal')
  })

  const rowBaseline = totalTop + BASELINE + 1.2
  setStyle(doc, 'bold', 11, BLACK)
  drawText(doc, total[0], TEXT_X, rowBaseline, 'bold')
  setStyle(doc, 'normal', 11, BLACK)
  drawText(doc, total[1], VALUE_X, rowBaseline, 'normal')

  return bottom
}

function centered(doc: Doc, text: string, centre: number, y: number, style: Style) {
  drawText(doc, text, centre - measure(doc, text, style) / 2, y, style)
}

export async function renderPayslip(input: PayslipInput): Promise<Blob> {
  const [{ default: jsPDF }, fonts] = await Promise.all([import('jspdf'), loadFonts()])
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true }) as unknown as Doc
  for (const [family, style, file, data] of fonts) {
    doc.addFileToVFS(file, data)
    doc.addFont(file, family, style)
  }

  const { org, currency } = input
  const monthName = MONTHS_LONG[input.month - 1]
  const lastDay = daysInMonth(input.month, input.year)
  const shortMonth = MONTHS_SHORT[input.month - 1]
  const breakdown = input.breakdown ?? null
  const earnings = breakdown ? sumLines(breakdown.earnings) : input.earnings
  const deductions = breakdown ? sumLines(breakdown.deductions) : input.deductions
  const net = Math.round((earnings - deductions) * 100) / 100

  // Logo — the square badge, top left.
  if (org.logo) {
    const boxW = 108.9
    const boxH = 92.8
    const ratio = org.logo.width / org.logo.height
    const w = ratio >= boxW / boxH ? boxW : boxH * ratio
    const h = ratio >= boxW / boxH ? boxW / ratio : boxH
    doc.addImage(org.logo.dataUrl, org.logo.format, 91.5, 73.4, w, h)
  }

  setStyle(doc, 'bold', 13, ACCENT)
  drawText(doc, `Salary Slip for the Month of ${monthName} ${input.year}`, TEXT_X, 193.6, 'bold')

  const money = (amount: number) => payslipMoney(amount, currency)
  const optional = (label: string, value: string | undefined): Array<[string, string]> =>
    value?.trim() ? [[label, value.trim()]] : []

  const gridRows: Array<[string, string]> = breakdown
    ? [
        ['Emp Name', input.employeeName],
        ...optional('Emp ID', breakdown.employeeCode),
        ['Emp Email', input.employeeEmail],
        ['Designation', input.designation],
        ...optional('Date of Joining', breakdown.dateOfJoining),
        ...optional('PF No', breakdown.pfNumber),
        ...optional('Bank Details', breakdown.bankDetails),
        ['Gross Monthly Salary', money(earnings)],
      ]
    : [
        ['Emp Name', input.employeeName],
        ['Emp Email', input.employeeEmail],
        ['Designation', input.designation],
        [
          input.basis === 'annual' ? 'Annual Salary' : 'Monthly Salary',
          payslipMoney(input.salary, currency, { cents: false }),
        ],
      ]
  gridRows.push(
    ['Working Days in Period', `${input.workingDays} days`],
    ['Pay Period', `01-${shortMonth}-${input.year} to ${lastDay}-${shortMonth}-${input.year}`]
  )

  const gridTop = 199.1
  drawGrid(doc, gridTop, gridRows)

  /*
   * Everything below the grid flows from it. The simple slip's gaps are the
   * measured originals, so it lands on exactly the coordinates it always did;
   * the itemised slip is taller, so its gaps tighten to keep clear of the footer.
   */
  const gap = breakdown
    ? { section: 24, between: 24, net: 22, note: 22, queries: 18 }
    : { section: 36.7, between: 37.2, net: 36.6, note: 34.2, queries: 25.8 }

  const earningsBottom = drawSection(
    doc,
    gridTop + gridRows.length * ROW + gap.section,
    'Earnings',
    (breakdown?.earnings ?? []).map((line) => [line.label, money(line.amount)]),
    [breakdown ? 'Gross Salary' : 'Net Payable', money(earnings)]
  )
  const deductionsBottom = drawSection(
    doc,
    earningsBottom + gap.between,
    'Deductions',
    (breakdown?.deductions ?? []).map((line) => [line.label, money(line.amount)]),
    ['Total Deductions', money(deductions)]
  )

  // The net line and its blue underline.
  const netY = deductionsBottom + gap.net
  setStyle(doc, 'bolditalic', 11, ACCENT)
  drawText(
    doc,
    `Net Salary Payable: ${payslipMoney(net, currency, { spaced: true })}`,
    137.2, netY, 'bolditalic'
  )
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.75)
  doc.line(137.2, netY + 9.5, 477.4, netY + 9.5)

  const noteY = netY + gap.note
  setStyle(doc, 'bold', 11, BLACK)
  drawText(doc, 'Note: This is a system-generated salary slip. No signature required.', TEXT_X, noteY, 'bold')

  if (org.queriesEmail) {
    const queriesY = noteY + gap.queries
    setStyle(doc, 'normal', 11, BLACK)
    const lead = 'For queries, contact: '
    const width = drawText(doc, lead, TEXT_X, queriesY, 'normal')
    drawLink(doc, org.queriesEmail, `mailto:${org.queriesEmail}`, TEXT_X + width, queriesY, 11)
  }

  /* Footer — centred on the text block, not the page, as in the original. */
  const centre = 325
  setStyle(doc, 'bold', 14, BLACK)
  centered(doc, org.name, centre, 678.4, 'bold')
  if (org.tagline) {
    setStyle(doc, 'italic', 8, BLACK)
    centered(doc, org.tagline, centre, 689.3, 'italic')
  }
  doc.setDrawColor(...FOOTER_RULE)
  doc.setLineWidth(0.75)
  doc.line(93.4, 700.3, 520.5, 700.3)

  if (org.address) {
    setStyle(doc, 'normal', 11, BLACK)
    centered(doc, org.address, centre, 728.6, 'normal')
  }

  // "Email: info@… | Website: https://…", with both addresses as links.
  const parts: Array<{ text: string; url?: string }> = []
  if (org.email) parts.push({ text: 'Email: ' }, { text: org.email, url: `mailto:${org.email}` })
  if (org.website) {
    const url = /^https?:\/\//i.test(org.website) ? org.website : `https://${org.website}`
    if (parts.length) parts.push({ text: ' | ' })
    parts.push({ text: 'Website: ' }, { text: url, url })
  }
  if (parts.length) {
    const y = 742.1
    setStyle(doc, 'normal', 11, BLACK)
    const total = parts.reduce((sum, part) => sum + measure(doc, part.text, 'normal'), 0)
    let x = centre - total / 2
    for (const part of parts) {
      if (part.url) {
        x += drawLink(doc, part.text, part.url, x, y, 11)
      } else {
        setStyle(doc, 'normal', 11, BLACK)
        x += drawText(doc, part.text, x, y, 'normal')
      }
    }
  }

  return doc.output('blob')
}

/** `Payslip-Tushar-Sekharamantri-June-2025.pdf` */
export function payslipFileName(employeeName: string, month: number, year: number): string {
  const slug = employeeName.trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee'
  return `Payslip-${slug}-${MONTHS_LONG[month - 1]}-${year}.pdf`
}
