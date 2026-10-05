'use client'

/**
 * The US earnings statement (056), for slips paid in US dollars.
 *
 * Laid out the way US payroll providers print a pay stub: the company block
 * and an "Earnings Statement" title with the period dates; the tax filing
 * block; the employee's name and mailing address; an earnings table with this
 * period and year to date; statutory deductions; net pay; the direct-deposit
 * line; and the detachable "not a check" voucher at the bottom.
 *
 * Only jsPDF's built-in Helvetica and Courier are used — no font download —
 * because a US stub has no ₹ to draw. US Letter, in points.
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
  setLineWidth(w: number): void
  text(text: string, x: number, y: number, options?: { angle?: number }): void
  line(x1: number, y1: number, x2: number, y2: number): void
  getTextWidth(text: string): number
  addImage(data: string, format: string, x: number, y: number, w: number, h: number): void
  output(type: 'blob'): Blob
}

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

function font(doc: Doc, family: 'helvetica' | 'courier', style: 'normal' | 'bold', size: number) {
  doc.setFont(family, style)
  doc.setFontSize(size)
  doc.setTextColor(0, 0, 0)
}

function right(doc: Doc, text: string, x: number, y: number) {
  doc.text(text, x - doc.getTextWidth(text), y)
}

/** Bold, underlined column heading. `align` is where `x` sits on the text. */
function heading(doc: Doc, text: string, x: number, y: number, align: 'left' | 'right' = 'left') {
  font(doc, 'helvetica', 'bold', 7.5)
  const width = doc.getTextWidth(text)
  const left = align === 'right' ? x - width : x
  doc.text(text, left, y)
  doc.setLineWidth(0.6)
  doc.line(left, y + 1.6, left + width, y + 1.6)
}

function rule(doc: Doc, x1: number, x2: number, y: number) {
  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.6)
  doc.line(x1, y, x2, y)
}

/** `XXXXXX3952` — the length of the mask does not leak the account's length. */
const maskedAccount = (last4: string) => `XXXXXX${last4.replace(/\D/g, '').slice(-4)}`

export async function renderUsPayslip(input: UsPayslipInput): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true }) as unknown as Doc
  const { org, details } = input
  const totals = usTotals(details)

  /* ---- Top left: company code block and address ---- */
  heading(doc, 'Company Code', 99.7, 36.6)
  heading(doc, 'Loc/Dept', 178.8, 36.6)
  heading(doc, 'Number', 221.8, 36.6)
  heading(doc, 'Page', 257.8, 36.6)
  font(doc, 'helvetica', 'bold', 7.5)
  doc.text(details.companyCode || '—', 99.7, 45)
  font(doc, 'helvetica', 'normal', 7.5)
  doc.text(details.locDept || '', 178.8, 45)
  font(doc, 'helvetica', 'bold', 7.5)
  doc.text(details.voucherNumber || '', 221.8, 45)
  font(doc, 'helvetica', 'normal', 7.5)
  doc.text('1 of 1', 257.8, 45)

  font(doc, 'helvetica', 'normal', 8)
  ;[org.name.toUpperCase(), ...org.addressLines].forEach((line, index) => {
    doc.text(line, 108, 54 + index * 9)
  })

  /* ---- Top right: title, dates, logo ---- */
  font(doc, 'helvetica', 'bold', 13.5)
  doc.text('Earnings Statement', 330.5, 43.7)
  if (org.logo) {
    const boxW = 60
    const boxH = 30
    const ratio = org.logo.width / org.logo.height
    const w = ratio >= boxW / boxH ? boxW : boxH * ratio
    const h = ratio >= boxW / boxH ? boxW / ratio : boxH
    doc.addImage(org.logo.dataUrl, org.logo.format, 540 - w, 26, w, h)
  }
  font(doc, 'helvetica', 'normal', 7)
  ;[
    ['Period Starting:', usDate(details.periodStart)],
    ['Period Ending:', usDate(details.periodEnd)],
    ['Pay Date:', usDate(details.payDate)],
  ].forEach(([label, value], index) => {
    doc.text(label, 330.5, 61.7 + index * 7.8)
    doc.text(value, 399.3, 61.7 + index * 7.8)
  })

  /* ---- Tax filing block ---- */
  font(doc, 'helvetica', 'normal', 7)
  doc.text(`Taxable Filing Status: ${details.filingStatus || 'Single'}`, 81.7, 120)
  doc.text('Exemptions/Allowances:', 81.7, 127.6)
  doc.text('Tax Override:', 212, 127.6)
  const allowances: Array<[string, string, string]> = [
    ['Federal:', details.federalAllowances || 'Std W/H Table', `${details.federalAdditional || '0.00'} Addnl`],
    ['State:', details.stateAllowances || '0', ''],
    ['Local:', details.localAllowances || '0', ''],
  ]
  allowances.forEach(([label, value, override], index) => {
    const y = 135.2 + index * 7.6
    doc.text(label, 99.7, y)
    doc.text(value, 142.7, y)
    doc.text(label, 218.6, y)
    if (override) doc.text(override, 261, y)
  })
  doc.text('Social Security Number: XXX-XX-XXXX', 81.7, 158.4)

  /* ---- Employee name and mailing address ---- */
  font(doc, 'helvetica', 'bold', 10.5)
  ;[input.employeeName, ...details.addressLines.filter((line) => line.trim())].slice(0, 5).forEach((line, index) => {
    doc.text(line, 365.9, 128.6 + index * 10.6)
  })

  /* ---- Earnings ---- */
  const L = 31.5
  heading(doc, 'Earnings', L, 184.5)
  heading(doc, 'rate', 126, 184.5, 'right')
  heading(doc, 'hours/units', 182, 184.5, 'right')
  heading(doc, 'this period', 263.6, 184.5, 'right')
  heading(doc, 'year to date', 328, 184.5, 'right')
  rule(doc, L, 328, 186.4)

  let y = 195.5
  for (const line of details.earnings) {
    font(doc, 'helvetica', 'normal', 7.5)
    doc.text(line.label, L, y)
    font(doc, 'courier', 'normal', 7.5)
    if (line.rate != null) right(doc, plain(line.rate), 126, y)
    right(doc, plain(line.hours ?? 0), 194, y)
    right(doc, plain(line.amount), 265, y)
    right(doc, plain(line.ytd), 328, y)
    y += 9.5
  }

  rule(doc, 85.5, 267, y + 2)
  y += 11
  font(doc, 'helvetica', 'bold', 7.5)
  doc.text('Gross Pay', 85.5, y)
  font(doc, 'courier', 'bold', 8)
  right(doc, dollars(totals.gross), 265, y)
  font(doc, 'courier', 'normal', 7.5)
  right(doc, dollars(totals.grossYtd), 328, y)
  rule(doc, 85.5, 267, y + 4)

  /* ---- Statutory deductions ---- */
  y += 25
  heading(doc, 'Statutory Deductions', 103.5, y)
  heading(doc, 'this period', 265, y, 'right')
  heading(doc, 'year to date', 328, y, 'right')
  rule(doc, 103.5, 328, y + 1.9)
  y += 11.5
  const deductions = details.deductions.filter((line) => line.amount || line.ytd)
  for (const line of deductions) {
    font(doc, 'helvetica', 'normal', 7.5)
    doc.text(line.label, 103.5, y)
    font(doc, 'courier', 'normal', 7.5)
    right(doc, line.amount ? `-${plain(line.amount)}` : '0.00', 267, y)
    right(doc, plain(line.ytd), 328, y)
    y += 9.5
  }

  rule(doc, 103.5, 267, y + 0.5)
  y += 10
  font(doc, 'helvetica', 'bold', 7.5)
  doc.text('Net Pay', 103.5, y)
  font(doc, 'courier', 'bold', 8)
  right(doc, dollars(totals.net), 267, y)
  rule(doc, 103.5, 267, y + 4)

  /* ---- Right column: deposits and notes ---- */
  const R = 354
  font(doc, 'helvetica', 'bold', 7.5)
  doc.text('Deposits', R, 237)
  heading(doc, 'account number', R, 245)
  heading(doc, 'transit/ABA', 475.8, 245)
  heading(doc, 'amount', 577.4, 245, 'right')
  rule(doc, R, 577.4, 247.4)
  font(doc, 'courier', 'normal', 7.5)
  doc.text(maskedAccount(details.accountLast4), R, 256.5)
  doc.text('XXXXXXXXX', 475.8, 256.5)
  right(doc, plain(totals.net), 578.7, 256.5)

  heading(doc, 'Important Notes', R, 271.3)
  rule(doc, R, 580.6, 273.2)
  font(doc, 'helvetica', 'normal', 7)
  doc.text(`Basis of pay: ${details.basisOfPay || 'Salaried'}`, R, 283)

  font(doc, 'helvetica', 'normal', 7)
  doc.text(`Your federal taxable wages this period are ${dollars(totals.gross)}`, 351.7, 528.5)

  /* ---- The voucher ---- */
  font(doc, 'helvetica', 'normal', 7.5)
  ;[org.name.toUpperCase(), ...org.addressLines].forEach((line, index) => {
    doc.text(line, 102.9, 574 + index * 8)
  })
  font(doc, 'helvetica', 'bold', 8)
  doc.text('Pay Date:', 329.9, 585.7)
  font(doc, 'courier', 'normal', 9)
  doc.text(usDate(details.payDate), 419.9, 585.7)

  heading(doc, 'Deposited to the account', 84.9, 628.2)
  heading(doc, 'account number', 337, 628.2)
  heading(doc, 'transit/ABA', 460.4, 628.2)
  heading(doc, 'amount', 561.3, 628.2, 'right')
  rule(doc, 84.9, 561.3, 630.6)
  font(doc, 'helvetica', 'normal', 7.5)
  doc.text(`${details.accountType || 'Checking'} DirectDeposit`, 84.9, 640.4)
  font(doc, 'courier', 'normal', 7.5)
  doc.text(maskedAccount(details.accountLast4), 337, 640.4)
  doc.text('XXXXXXXXX', 460.4, 640.4)
  right(doc, plain(totals.net), 561.3, 640.4)

  // The watermark, drawn last so it sits over the deposit line as on a real stub.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(30)
  doc.setTextColor(185, 185, 185)
  doc.text('THIS IS NOT A CHECK', 172, 678, { angle: 10 })

  return doc.output('blob')
}
