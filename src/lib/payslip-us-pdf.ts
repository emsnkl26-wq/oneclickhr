'use client'

/**
 * The US earnings statement (056), for slips paid in US dollars.
 *
 * Same statement, laid out on a GRID (059). The first version of this file
 * placed every string at a hand-measured absolute point — `heading(doc, 'Page',
 * 257.8, 36.6)` — copied off a scan of a real ADP stub. It printed the right
 * facts and it was unmaintainable and slightly wrong everywhere: the columns in
 * the three tables did not line up with each other (267 here, 265 there, 578.7
 * in one place), the left edge changed four times down the page, and a long
 * company name or a fifth address line ran into whatever was beside it.
 *
 * So the numbers are now DERIVED. There is one margin, one content width, and
 * each block returns the y it finished at, so adding an earnings line pushes
 * everything below it down instead of overlapping. Column positions come from a
 * single `COLUMNS` table shared by all three money tables, which is what makes
 * the figures actually sit under each other. Panels, rules and a tinted net-pay
 * band replace the underlined-heading look, and the voucher is separated by a
 * real perforation line rather than a gap.
 *
 * EVERY FIELD THE OLD LAYOUT CARRIED IS STILL HERE, and the stored shape
 * (`UsPayslipDetails`) is untouched — a slip issued before this change reads
 * back and re-renders identically.
 *
 * Only jsPDF's built-in Helvetica and Courier are used — no font download —
 * because a US stub has no ₹ to draw. Courier for figures, so digits are
 * monospaced and columns of money align on the decimal point. US Letter, in
 * points.
 */

import type { LogoAsset } from '@/lib/document-pdf'
import type { PayslipLine } from '@/lib/payslip-breakdown'

/** One earnings line: Regular, Overtime, Bonus … */
export interface UsEarningLine {
  label: string
  /** Hourly rate, when the line is hours × rate. */
  rate: number | null
  hours: number | null
  amount: number
  ytd: number
}

/** One statutory deduction: Federal Income, Social Security, Medicare … */
export interface UsDeductionLine extends PayslipLine {
  ytd: number
}

/** What a US slip records, stored on the payslip so next period starts from it. */
export interface UsPayslipDetails {
  format: 'us'
  companyCode: string
  locDept: string
  voucherNumber: string
  /** ISO dates. */
  periodStart: string
  periodEnd: string
  payDate: string
  filingStatus: string
  federalAllowances: string
  stateAllowances: string
  localAllowances: string
  federalAdditional: string
  /** Mailing address, one line per entry, under the employee's name. */
  addressLines: string[]
  basisOfPay: string
  accountType: string
  /** Last four digits only — a slip never carries a full account number. */
  accountLast4: string
  earnings: UsEarningLine[]
  deductions: UsDeductionLine[]
}

export interface UsPayslipInput {
  org: {
    name: string
    logo: LogoAsset | null
    /** Street, then "City, ST 21043". */
    addressLines: string[]
  }
  employeeName: string
  details: UsPayslipDetails
}

type Doc = {
  setFont(family: string, style?: string): void
  setFontSize(size: number): void
  setTextColor(r: number, g: number, b: number): void
  setDrawColor(r: number, g: number, b: number): void
  setFillColor(r: number, g: number, b: number): void
  setLineWidth(w: number): void
  setLineDashPattern(pattern: number[], phase: number): void
  text(text: string, x: number, y: number, options?: { angle?: number }): void
  line(x1: number, y1: number, x2: number, y2: number): void
  rect(x: number, y: number, w: number, h: number, style?: string): void
  getTextWidth(text: string): number
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void
  output(type: 'blob'): Blob
}

/* ------------------------------------------------------------------ Totals */

const round2 = (value: number) => Math.round(value * 100) / 100

export function usTotals(details: Pick<UsPayslipDetails, 'earnings' | 'deductions'>) {
  const sum = (values: number[]) => round2(values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0))
  const gross = sum(details.earnings.map((line) => line.amount))
  const grossYtd = sum(details.earnings.map((line) => line.ytd))
  const deductions = sum(details.deductions.map((line) => line.amount))
  return { gross, grossYtd, deductions, net: round2(gross - deductions) }
}

/** `2026-09-30` → `09/30/2026`. */
export function usDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return match ? `${match[2]}/${match[3]}/${match[1]}` : iso
}

const plain = (n: number) => n.toFixed(2)
const dollars = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/* ------------------------------------------------------------------- Grid */

/**
 * THE ONE SET OF MEASUREMENTS. Everything on the page is positioned from these,
 * which is the whole difference from the previous version of this file.
 */
const PAGE = { width: 612, height: 792 }
const M = 42 // the single left/right margin
const RIGHT = PAGE.width - M
const WIDTH = RIGHT - M

/** Greys, named once so a rule and a panel border cannot drift apart. */
const INK = [17, 17, 17] as const
const MUTED = [105, 105, 105] as const
const RULE = [160, 160, 160] as const
const HAIRLINE = [205, 205, 205] as const
const PANEL = [246, 246, 246] as const

/**
 * The money columns, as RIGHT edges measured from the page's right margin.
 *
 * Shared by the earnings table, the deductions table and both deposit tables,
 * which is what makes a figure in one sit directly under a figure in another.
 * The old layout gave each table its own numbers and none of them matched.
 */
const COLUMNS = {
  rate: M + 250,
  hours: M + 330,
  period: M + 430,
  ytd: RIGHT,
}

function font(doc: Doc, family: 'helvetica' | 'courier', style: 'normal' | 'bold', size: number) {
  doc.setFont(family, style)
  doc.setFontSize(size)
}

function ink(doc: Doc, colour: readonly [number, number, number]) {
  doc.setTextColor(colour[0], colour[1], colour[2])
}

/** Right-aligned text, with `x` as the right edge. */
function right(doc: Doc, text: string, x: number, y: number) {
  doc.text(text, x - doc.getTextWidth(text), y)
}

function rule(
  doc: Doc,
  x1: number,
  x2: number,
  y: number,
  colour: readonly [number, number, number] = RULE,
  width = 0.6
) {
  doc.setDrawColor(colour[0], colour[1], colour[2])
  doc.setLineWidth(width)
  doc.setLineDashPattern([], 0)
  doc.line(x1, y, x2, y)
}

/** A filled panel with a hairline border — the background for a label block. */
function panel(doc: Doc, x: number, y: number, w: number, h: number) {
  doc.setFillColor(PANEL[0], PANEL[1], PANEL[2])
  doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2])
  doc.setLineWidth(0.5)
  doc.rect(x, y, w, h, 'FD')
}

/** A small-caps section title over a full-width rule. */
function sectionTitle(doc: Doc, text: string, y: number, x = M, x2 = RIGHT): number {
  font(doc, 'helvetica', 'bold', 7.5)
  ink(doc, MUTED)
  doc.text(text.toUpperCase(), x, y)
  rule(doc, x, x2, y + 3.2, RULE, 0.8)
  return y + 3.2
}

/** A `LABEL` above its `value`, the shape used by every meta cell on the page. */
function labelled(doc: Doc, label: string, value: string, x: number, y: number) {
  font(doc, 'helvetica', 'normal', 6)
  ink(doc, MUTED)
  doc.text(label.toUpperCase(), x, y)
  font(doc, 'helvetica', 'bold', 8)
  ink(doc, INK)
  doc.text(value || '—', x, y + 9.5)
}

/** `XXXXXX3952` — the length of the mask does not leak the account's length. */
const maskedAccount = (last4: string) => `XXXXXX${last4.replace(/\D/g, '').slice(-4)}`

/* ------------------------------------------------------------------ Render */

export async function renderUsPayslip(input: UsPayslipInput): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true }) as unknown as Doc
  const { org, details } = input
  const totals = usTotals(details)

  /* ---- Masthead: company on the left, title and logo on the right -------- */
  let y = 54

  font(doc, 'helvetica', 'bold', 12)
  ink(doc, INK)
  doc.text(org.name.toUpperCase(), M, y)
  font(doc, 'helvetica', 'normal', 7.5)
  ink(doc, MUTED)
  org.addressLines.filter((line) => line.trim()).slice(0, 3).forEach((line, index) => {
    doc.text(line, M, y + 12 + index * 9)
  })

  // The logo sits ABOVE the title rather than beside it. Beside it was what the
  // old layout did, and a wide logo and a long title then fought for the same
  // strip; stacked, neither can push the other anywhere.
  if (org.logo) {
    const boxW = 96
    const boxH = 34
    const ratio = org.logo.width / org.logo.height
    const w = ratio >= boxW / boxH ? boxW : boxH * ratio
    const h = ratio >= boxW / boxH ? boxW / ratio : boxH
    doc.addImage(org.logo.dataUrl, org.logo.format, RIGHT - w, y - 42, w, h)
  }

  font(doc, 'helvetica', 'bold', 15)
  ink(doc, INK)
  right(doc, 'Earnings Statement', RIGHT, y)
  font(doc, 'helvetica', 'normal', 7)
  ink(doc, MUTED)
  right(doc, 'This is a record of pay, not a negotiable instrument.', RIGHT, y + 11)

  y += 34
  rule(doc, M, RIGHT, y, INK, 1.1)

  /* ---- The meta strip: company code, loc/dept, number, page, and dates --- */
  y += 10
  const metaH = 30
  panel(doc, M, y, WIDTH, metaH)
  const metaCells: Array<[string, string]> = [
    ['Company Code', details.companyCode],
    ['Loc / Dept', details.locDept],
    ['Voucher Number', details.voucherNumber],
    ['Page', '1 of 1'],
    ['Pay Date', usDate(details.payDate)],
  ]
  const metaStep = WIDTH / metaCells.length
  metaCells.forEach(([label, value], index) => {
    labelled(doc, label, value, M + 9 + index * metaStep, y + 11)
    if (index > 0) {
      doc.setDrawColor(HAIRLINE[0], HAIRLINE[1], HAIRLINE[2])
      doc.setLineWidth(0.5)
      doc.line(M + index * metaStep, y + 4, M + index * metaStep, y + metaH - 4)
    }
  })
  y += metaH + 18

  /* ---- Two panels: who is being paid, and for what period / withholding -- */
  const colGap = 16
  const colW = (WIDTH - colGap) / 2
  const rightX = M + colW + colGap
  const blockTop = y

  // LEFT: the employee and their mailing address.
  let leftY = sectionTitle(doc, 'Paid to', blockTop, M, M + colW) + 14
  font(doc, 'helvetica', 'bold', 10.5)
  ink(doc, INK)
  doc.text(input.employeeName, M, leftY)
  leftY += 12
  font(doc, 'helvetica', 'normal', 8)
  ink(doc, MUTED)
  details.addressLines
    .filter((line) => line.trim())
    .slice(0, 4)
    .forEach((line) => {
      doc.text(line, M, leftY)
      leftY += 9.5
    })
  leftY += 4
  font(doc, 'helvetica', 'normal', 7)
  doc.text('Social Security Number: XXX-XX-XXXX', M, leftY)
  leftY += 9.5
  doc.text(`Basis of pay: ${details.basisOfPay || 'Salaried'}`, M, leftY)

  // RIGHT: the period, then the tax withholding block.
  let rY = sectionTitle(doc, 'Pay period', blockTop, rightX, RIGHT) + 13
  font(doc, 'helvetica', 'normal', 7.5)
  ;[
    ['Period Starting', usDate(details.periodStart)],
    ['Period Ending', usDate(details.periodEnd)],
    ['Pay Date', usDate(details.payDate)],
  ].forEach(([label, value]) => {
    ink(doc, MUTED)
    font(doc, 'helvetica', 'normal', 7.5)
    doc.text(label, rightX, rY)
    font(doc, 'courier', 'bold', 8)
    ink(doc, INK)
    right(doc, value, RIGHT, rY)
    rY += 10.5
  })

  rY += 6
  rY = sectionTitle(doc, 'Tax withholding', rY, rightX, RIGHT) + 13
  font(doc, 'helvetica', 'normal', 7.5)
  ink(doc, MUTED)
  doc.text('Taxable Filing Status', rightX, rY)
  font(doc, 'helvetica', 'bold', 7.5)
  ink(doc, INK)
  right(doc, details.filingStatus || 'Single', RIGHT, rY)
  rY += 11

  font(doc, 'helvetica', 'normal', 6.5)
  ink(doc, MUTED)
  doc.text('EXEMPTIONS / ALLOWANCES', rightX, rY)
  right(doc, 'TAX OVERRIDE', RIGHT, rY)
  rY += 9.5

  const allowances: Array<[string, string, string]> = [
    [
      'Federal',
      details.federalAllowances || 'Std W/H Table',
      `${details.federalAdditional || '0.00'} Addnl`,
    ],
    ['State', details.stateAllowances || '0', ''],
    ['Local', details.localAllowances || '0', ''],
  ]
  allowances.forEach(([label, value, override]) => {
    font(doc, 'helvetica', 'normal', 7.5)
    ink(doc, MUTED)
    doc.text(label, rightX, rY)
    font(doc, 'courier', 'normal', 7.5)
    ink(doc, INK)
    doc.text(value, rightX + 48, rY)
    if (override) right(doc, override, RIGHT, rY)
    rY += 10
  })

  // Both columns are independent, so the page continues below the TALLER one.
  y = Math.max(leftY, rY) + 20

  /* ---- Earnings ---------------------------------------------------------- */
  y = sectionTitle(doc, 'Earnings', y) + 13
  font(doc, 'helvetica', 'normal', 6.5)
  ink(doc, MUTED)
  doc.text('DESCRIPTION', M, y)
  right(doc, 'RATE', COLUMNS.rate, y)
  right(doc, 'HOURS / UNITS', COLUMNS.hours, y)
  right(doc, 'THIS PERIOD', COLUMNS.period, y)
  right(doc, 'YEAR TO DATE', COLUMNS.ytd, y)
  y += 4
  rule(doc, M, RIGHT, y, HAIRLINE, 0.5)
  y += 12

  for (const line of details.earnings) {
    font(doc, 'helvetica', 'normal', 8)
    ink(doc, INK)
    doc.text(line.label, M, y)
    font(doc, 'courier', 'normal', 8)
    // A salaried line has no rate and no hours; printing `0.00` in both would
    // state something false about it.
    if (line.rate != null) right(doc, plain(line.rate), COLUMNS.rate, y)
    if (line.hours != null) right(doc, plain(line.hours), COLUMNS.hours, y)
    right(doc, plain(line.amount), COLUMNS.period, y)
    right(doc, plain(line.ytd), COLUMNS.ytd, y)
    y += 12.5
  }

  y += 1
  rule(doc, M, RIGHT, y, RULE, 0.8)
  y += 13
  font(doc, 'helvetica', 'bold', 8.5)
  ink(doc, INK)
  doc.text('Gross Pay', M, y)
  font(doc, 'courier', 'bold', 9)
  right(doc, dollars(totals.gross), COLUMNS.period, y)
  font(doc, 'courier', 'normal', 8)
  right(doc, dollars(totals.grossYtd), COLUMNS.ytd, y)
  y += 24

  /* ---- Statutory deductions ---------------------------------------------- */
  y = sectionTitle(doc, 'Statutory deductions', y) + 13
  font(doc, 'helvetica', 'normal', 6.5)
  ink(doc, MUTED)
  doc.text('DESCRIPTION', M, y)
  right(doc, 'THIS PERIOD', COLUMNS.period, y)
  right(doc, 'YEAR TO DATE', COLUMNS.ytd, y)
  y += 4
  rule(doc, M, RIGHT, y, HAIRLINE, 0.5)
  y += 12

  const deductions = details.deductions.filter((line) => line.amount || line.ytd)
  if (deductions.length === 0) {
    font(doc, 'helvetica', 'normal', 8)
    ink(doc, MUTED)
    doc.text('None withheld this period', M, y)
    y += 12.5
  }
  for (const line of deductions) {
    font(doc, 'helvetica', 'normal', 8)
    ink(doc, INK)
    doc.text(line.label, M, y)
    font(doc, 'courier', 'normal', 8)
    right(doc, line.amount ? `-${plain(line.amount)}` : '0.00', COLUMNS.period, y)
    right(doc, plain(line.ytd), COLUMNS.ytd, y)
    y += 12.5
  }

  y += 1
  rule(doc, M, RIGHT, y, RULE, 0.8)
  y += 13
  font(doc, 'helvetica', 'bold', 8.5)
  ink(doc, INK)
  doc.text('Total Deductions', M, y)
  font(doc, 'courier', 'bold', 9)
  right(doc, `-${plain(totals.deductions)}`, COLUMNS.period, y)
  y += 16

  /* ---- Net pay, as the one emphasised figure on the page ----------------- */
  const netH = 28
  panel(doc, M, y, WIDTH, netH)
  font(doc, 'helvetica', 'bold', 10)
  ink(doc, INK)
  doc.text('NET PAY', M + 12, y + 18)
  font(doc, 'helvetica', 'normal', 7)
  ink(doc, MUTED)
  doc.text(
    `Gross ${dollars(totals.gross)}  less deductions ${dollars(totals.deductions)}`,
    M + 70,
    y + 18
  )
  font(doc, 'courier', 'bold', 13)
  ink(doc, INK)
  right(doc, dollars(totals.net), RIGHT - 12, y + 19)
  y += netH + 20

  /* ---- Deposits ---------------------------------------------------------- */
  y = sectionTitle(doc, 'Deposits', y) + 13
  font(doc, 'helvetica', 'normal', 6.5)
  ink(doc, MUTED)
  doc.text('ACCOUNT NUMBER', M, y)
  doc.text('TRANSIT / ABA', COLUMNS.rate, y)
  right(doc, 'AMOUNT', COLUMNS.ytd, y)
  y += 4
  rule(doc, M, RIGHT, y, HAIRLINE, 0.5)
  y += 12
  font(doc, 'courier', 'normal', 8)
  ink(doc, INK)
  doc.text(maskedAccount(details.accountLast4), M, y)
  doc.text('XXXXXXXXX', COLUMNS.rate, y)
  right(doc, plain(totals.net), COLUMNS.ytd, y)
  y += 24

  /* ---- Important notes --------------------------------------------------- */
  y = sectionTitle(doc, 'Important notes', y) + 13
  font(doc, 'helvetica', 'normal', 7.5)
  ink(doc, MUTED)
  ;[
    `Basis of pay: ${details.basisOfPay || 'Salaried'}.`,
    `Your federal taxable wages this period are ${dollars(totals.gross)}.`,
    'Year-to-date figures include this period.',
  ].forEach((line) => {
    doc.text(line, M, y)
    y += 10.5
  })

  /* ---- The detachable voucher, pinned to the foot of the page ------------ */
  // Pinned rather than flowed, so the perforation is in the same place on every
  // slip regardless of how many earnings lines the period had.
  const perf = PAGE.height - 196
  doc.setDrawColor(RULE[0], RULE[1], RULE[2])
  doc.setLineWidth(0.6)
  doc.setLineDashPattern([3, 3], 0)
  doc.line(M, perf, RIGHT, perf)
  doc.setLineDashPattern([], 0)
  font(doc, 'helvetica', 'normal', 6)
  ink(doc, MUTED)
  doc.text('DETACH HERE', M, perf - 4)

  let vy = perf + 22
  font(doc, 'helvetica', 'bold', 9.5)
  ink(doc, INK)
  doc.text(org.name.toUpperCase(), M, vy)
  font(doc, 'helvetica', 'normal', 7.5)
  ink(doc, MUTED)
  org.addressLines.filter((line) => line.trim()).slice(0, 2).forEach((line, index) => {
    doc.text(line, M, vy + 11 + index * 9)
  })

  labelled(doc, 'Pay Date', usDate(details.payDate), COLUMNS.rate, vy - 6)
  labelled(doc, 'Voucher Number', details.voucherNumber || '—', COLUMNS.period - 40, vy - 6)
  font(doc, 'helvetica', 'normal', 6)
  ink(doc, MUTED)
  right(doc, 'NON-NEGOTIABLE', RIGHT, vy - 6)
  font(doc, 'courier', 'bold', 12)
  ink(doc, INK)
  right(doc, dollars(totals.net), RIGHT, vy + 8)

  vy += 44
  font(doc, 'helvetica', 'normal', 6.5)
  ink(doc, MUTED)
  doc.text('DEPOSITED TO THE ACCOUNT OF', M, vy)
  doc.text('ACCOUNT NUMBER', COLUMNS.rate, vy)
  doc.text('TRANSIT / ABA', COLUMNS.period - 40, vy)
  right(doc, 'AMOUNT', COLUMNS.ytd, vy)
  vy += 4
  rule(doc, M, RIGHT, vy, HAIRLINE, 0.5)
  vy += 13
  font(doc, 'helvetica', 'normal', 8)
  ink(doc, INK)
  doc.text(`${details.accountType || 'Checking'} Direct Deposit`, M, vy)
  font(doc, 'courier', 'normal', 8)
  doc.text(maskedAccount(details.accountLast4), COLUMNS.rate, vy)
  doc.text('XXXXXXXXX', COLUMNS.period - 40, vy)
  right(doc, plain(totals.net), COLUMNS.ytd, vy)

  // The watermark, drawn LAST so it sits over the deposit line as on a real
  // stub. Centred on the voucher rather than at a measured point, so it cannot
  // drift off the block it is meant to cover.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(196, 196, 196)
  const mark = 'THIS IS NOT A CHECK'
  doc.text(mark, M + (WIDTH - doc.getTextWidth(mark)) / 2, vy + 34, { angle: 8 })

  return doc.output('blob')
}
