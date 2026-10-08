import { describe, it, expect } from 'vitest'
import { parsePayslipText } from '@/lib/payslip-extract'

/**
 * The payslip parser (059).
 *
 * The cases below are the two layouts this actually meets in the wild — an
 * Indian itemised salary slip and a US earnings statement — plus the failures
 * that matter. The parse FEEDS A FORM A HUMAN THEN CHECKS, so the tests are
 * weighted towards "does it refuse to invent things" rather than "does it find
 * everything": a missed field costs some typing, a fabricated one costs
 * somebody the right pay.
 */

const INDIAN_SLIP = `
ACME TECHNOLOGIES PRIVATE LIMITED
Salary Slip for May 2024
All amounts in INR

Employee Name: Bhargav Reddy
Employee Code: ACM-1182
Designation: Project Manager
Date of Joining: 04-May-2020
PF No: AP/HYD/2225273/10148
Bank Details: 44511550017 / Standard Chartered

Earnings                        Amount
Basic                        25,000.00
HRA                          12,500.00
Conveyance Allowance          1,600.00
Special Allowance             5,900.00
Total Earnings               45,000.00

Deductions                      Amount
PF Employee                   3,000.00
Professional Tax                200.00
TDS                           1,800.00
Total Deductions              5,000.00

Net Salary Payable           40,000.00
`

const US_STUB = `
NEXTKIN LIFE LLC
Earnings Statement

Period Starting: 09/01/2026
Period Ending: 09/15/2026
Pay Date: 09/20/2026

Employee Name: Dana Whitfield
Taxable Filing Status: Single

Earnings            rate    hours    this period    year to date
Regular                              3,200.00         28,800.00
Overtime                               240.00          1,100.00
Gross Pay                            3,440.00         29,900.00

Statutory Deductions                 this period
Federal Income                         -412.80
Social Security                        -213.28
Medicare                                -49.88
Net Pay                               2,764.04
`

describe('an Indian itemised salary slip', () => {
  const result = parsePayslipText(INDIAN_SLIP)

  it('reads the identifying fields', () => {
    expect(result.employeeName).toBe('Bhargav Reddy')
    expect(result.employeeCode).toBe('ACM-1182')
    expect(result.designation).toBe('Project Manager')
    expect(result.pfNumber).toBe('AP/HYD/2225273/10148')
    expect(result.bankDetails).toBe('44511550017 / Standard Chartered')
    expect(result.dateOfJoining).toBe('2020-05-04')
  })

  it('recognises the currency and the period', () => {
    expect(result.currency).toBe('INR')
    expect(result.month).toBe(5)
    expect(result.year).toBe(2024)
  })

  it('splits the table into earnings and deductions', () => {
    expect(result.earnings.map((line) => line.label)).toEqual([
      'Basic',
      'HRA',
      'Conveyance Allowance',
      'Special Allowance',
    ])
    expect(result.deductions.map((line) => line.label)).toEqual([
      'PF Employee',
      'Professional Tax',
      'TDS',
    ])
  })

  it('parses lakh-grouped amounts', () => {
    expect(result.earnings[0].amount).toBe(25000)
    expect(result.earnings[1].amount).toBe(12500)
    expect(result.deductions[0].amount).toBe(3000)
  })

  it('keeps the printed totals OUT of the component lines', () => {
    // Otherwise the gross is counted twice and the net pay is wrong.
    const labels = [...result.earnings, ...result.deductions].map((l) => l.label.toLowerCase())
    expect(labels).not.toContain('total earnings')
    expect(labels).not.toContain('total deductions')
    expect(labels).not.toContain('net salary payable')
  })

  it('reads the printed totals separately, and agrees with its own arithmetic', () => {
    expect(result.grossPay).toBe(45000)
    expect(result.netPay).toBe(40000)
    const earnings = result.earnings.reduce((sum, line) => sum + line.amount, 0)
    expect(earnings).toBe(45000)
    expect(result.warnings).toEqual([])
    expect(result.confidence).toBe('high')
  })
})

describe('a US earnings statement', () => {
  const result = parsePayslipText(US_STUB)

  it('reads the period dates month-first', () => {
    expect(result.periodStart).toBe('2026-09-01')
    expect(result.periodEnd).toBe('2026-09-15')
    expect(result.payDate).toBe('2026-09-20')
  })

  it('reads a two-column row as this period AND year to date', () => {
    // `Regular  3,200.00  28,800.00` — the first column is the period's pay and
    // the last is the running total. Taking only the trailing number off the
    // line would book the whole year as this fortnight's wage.
    const regular = result.earnings.find((line) => line.label === 'Regular')
    expect(regular).toEqual({ label: 'Regular', amount: 3200, ytd: 28800 })
    const overtime = result.earnings.find((line) => line.label === 'Overtime')
    expect(overtime).toEqual({ label: 'Overtime', amount: 240, ytd: 1100 })
  })

  it('reconciles against the printed gross and net', () => {
    expect(result.grossPay).toBe(3440)
    expect(result.netPay).toBe(2764.04)
    // 3,200 + 240 is the printed gross, and gross less the three deductions is
    // the printed net, so there is nothing to warn about.
    expect(result.warnings).toEqual([])
    expect(result.confidence).toBe('high')
  })

  it('still classifies the deductions', () => {
    expect(result.deductions.map((line) => line.label)).toEqual([
      'Federal Income',
      'Social Security',
      'Medicare',
    ])
    // Negatives on a stub are magnitudes once they are in the deductions column.
    expect(result.deductions[0].amount).toBe(412.8)
  })
})

describe('refusing to invent things', () => {
  it('returns empty strings, not guesses, for fields that are absent', () => {
    const result = parsePayslipText('Payslip\nBasic 100.00\nNet Pay 100.00')
    expect(result.employeeName).toBe('')
    expect(result.designation).toBe('')
    expect(result.employeeCode).toBe('')
    expect(result.dateOfJoining).toBe('')
    expect(result.bankDetails).toBe('')
  })

  it('ignores lines whose label is mostly digits', () => {
    // An account number, a date row or a wrapped column of figures — none of
    // them is a salary component.
    const result = parsePayslipText(
      'Payslip\n44511550017 / 2024 1,000.00\n01/05/2024 500.00\nBasic 25,000.00'
    )
    expect(result.earnings.map((l) => l.label)).toEqual(['Basic'])
  })

  it('leaves out a figure it cannot classify rather than guessing a column', () => {
    const result = parsePayslipText('Payslip\nBasic 1,000.00\nSundry Widget Count 42.00')
    expect(result.earnings.map((l) => l.label)).toEqual(['Basic'])
    expect(result.deductions).toEqual([])
  })

  it('reads both separator conventions without being told the locale', () => {
    // Whichever separator comes LAST is the decimal point, so `1,234.56` and
    // `1.234,56` are the same amount and neither moves the decimal place.
    const western = parsePayslipText('Payslip\nBasic 1,234.56')
    const european = parsePayslipText('Payslip\nBasic 1.234,56')
    expect(western.earnings[0].amount).toBe(1234.56)
    expect(european.earnings[0].amount).toBe(1234.56)
  })

  it('reads a lone comma as grouping or as a decimal by what follows it', () => {
    // `1,234` is a thousand; `1234,5` is a decimal comma. Three digits after a
    // single comma is the ambiguous case and is read as grouping, because that
    // is overwhelmingly what these slips mean by it.
    expect(parsePayslipText('Payslip\nBasic 1,234').earnings[0].amount).toBe(1234)
    expect(parsePayslipText('Payslip\nBasic 1234,5').earnings[0].amount).toBe(1234.5)
    // Indian lakh grouping, where the groups are not all three digits.
    expect(parsePayslipText('Payslip\nBasic 1,23,456.78').earnings[0].amount).toBe(123456.78)
  })

  it('does not read the document title as a salary component', () => {
    // `Salary Slip for May 2024` ends in a number and contains "salary", and
    // was being booked as a ₹2,024 earning that threw the gross off by a year.
    const result = parsePayslipText('Salary Slip for May 2024\nBasic 25,000.00')
    expect(result.earnings.map((l) => l.label)).toEqual(['Basic'])
    expect(result.earnings[0].amount).toBe(25000)
  })

  it('says so when the document does not look like a payslip at all', () => {
    const result = parsePayslipText('INVOICE 0042\nConsulting services 5,000.00\nTotal 5,000.00')
    expect(result.warnings.join(' ')).toMatch(/does not look like a payslip/i)
    expect(result.confidence).toBe('low')
  })

  it('warns, rather than reporting success, when no earnings were found', () => {
    const result = parsePayslipText('Payslip for May 2024\nThank you for your service.')
    expect(result.earnings).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/no earnings lines were recognised/i)
    expect(result.confidence).toBe('low')
  })
})

describe('currency detection', () => {
  it('prefers a specific dollar code over a bare dollar sign', () => {
    expect(parsePayslipText('Payslip S$ 1,000.00 SGD').currency).toBe('SGD')
    expect(parsePayslipText('Payslip Net Pay $1,000.00').currency).toBe('USD')
  })

  it('reads a rupee slip from the symbol or the word', () => {
    expect(parsePayslipText('Payslip ₹ 25,000').currency).toBe('INR')
    expect(parsePayslipText('Payslip Rs. 25,000').currency).toBe('INR')
  })

  it('answers empty when nothing identifies the currency', () => {
    expect(parsePayslipText('Payslip\nBasic 1000.00').currency).toBe('')
  })
})
