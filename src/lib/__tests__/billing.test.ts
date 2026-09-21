import { describe, it, expect } from 'vitest'
import {
  billLines, payForWeek, unitsFor, lineDescription, serviceLines, servicePeriodLabel,
  monthServiceDescription,
} from '@/lib/billing'
import { computeTotals } from '@/lib/invoice'
import { assignmentSchema } from '@/lib/schemas'

/**
 * The staffing money chain.
 *
 * The single most important property under test is that BILL and PAY are two
 * different numbers derived from two different rates, and that nothing computes
 * one from the other. Everything else here is arithmetic.
 */

const week = (over: Partial<Parameters<typeof billLines>[0][number]> = {}) => ({
  id: 'ts-1',
  code: 'TS-00042',
  weekStart: '2026-09-13',
  weekEnd: '2026-09-19',
  billableHours: 40,
  employeeName: 'Alice Nguyen',
  ...over,
})

describe('unitsFor', () => {
  it('bills hours as hours', () => {
    expect(unitsFor(37.5, 'hour')).toBe(37.5)
  })

  it('converts hours to standard working days', () => {
    expect(unitsFor(40, 'day')).toBe(5)
    expect(unitsFor(20, 'day')).toBe(2.5)
  })

  it('treats a flat-period placement as one period, not a fraction of hours', () => {
    // A monthly placement is not cheaper because somebody took a Friday off.
    expect(unitsFor(32, 'month')).toBe(1)
    expect(unitsFor(40, 'month')).toBe(1)
    expect(unitsFor(40, 'year')).toBe(1)
  })
})

describe('billLines', () => {
  it('bills hours at the BILL rate', () => {
    const [line] = billLines([week()], 85, 'hour')
    expect(line.quantity).toBe(40)
    expect(line.rate).toBe(85)
    expect(computeTotals([line]).total).toBe(3400)
  })

  it('names the person and the week on every line', () => {
    const [line] = billLines([week()], 85, 'hour')
    expect(line.description).toContain('Alice Nguyen')
    expect(line.description).toContain('2026-09-13')
    expect(line.description).toContain('TS-00042')
  })

  it('drops a week with no billable hours rather than billing zero', () => {
    // "0.00" against somebody's name invites the vendor to ask what went wrong.
    expect(billLines([week({ billableHours: 0 })], 85, 'hour')).toEqual([])
  })

  it('produces one line per week', () => {
    const lines = billLines(
      [week(), week({ id: 'ts-2', code: 'TS-00043', billableHours: 32 })],
      85,
      'hour'
    )
    expect(lines).toHaveLength(2)
    expect(computeTotals(lines).total).toBe(40 * 85 + 32 * 85)
  })
})

describe('payForWeek', () => {
  it('pays at the PAY rate, which is not the bill rate', () => {
    const bill = computeTotals(billLines([week()], 85, 'hour')).total
    const pay = payForWeek(40, 55, 'hour')
    expect(pay).toBe(2200)
    expect(pay).not.toBe(bill)
    expect(pay! < bill).toBe(true)
  })

  it('returns null when no pay rate is set, rather than zero', () => {
    // "We have not set your rate yet" and "you earned nothing" are different
    // statements, and only one of them is true.
    expect(payForWeek(40, null, 'hour')).toBeNull()
  })

  it('rounds money to cents rather than accumulating float drift', () => {
    expect(payForWeek(7.5, 33.33, 'hour')).toBe(249.98)
  })
})

describe('assignmentSchema', () => {
  const base = {
    employeeId: '11111111-1111-4111-8111-111111111111',
    vendorId: '22222222-2222-4222-8222-222222222222',
  }

  it('accepts a placement where the bill rate exceeds the pay rate', () => {
    const result = assignmentSchema.safeParse({ ...base, billRate: 85, payRate: 55 })
    expect(result.success).toBe(true)
  })

  it('flags pay above bill in the same currency — almost always a transposition', () => {
    const result = assignmentSchema.safeParse({ ...base, billRate: 55, payRate: 85 })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['payRate'])
    }
  })

  it('does not compare rates across currencies, where the comparison is meaningless', () => {
    const result = assignmentSchema.safeParse({
      ...base,
      billRate: 85,
      billCurrency: 'USD',
      payRate: 3000,
      payCurrency: 'INR',
    })
    expect(result.success).toBe(true)
  })

  it('treats an empty rate box as "not set", not as zero', () => {
    const result = assignmentSchema.safeParse({ ...base, billRate: '', payRate: '' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.billRate).toBeNull()
      expect(result.data.payRate).toBeNull()
    }
  })

  it('refuses an end date before the start date', () => {
    const result = assignmentSchema.safeParse({
      ...base,
      startDate: '2026-09-01',
      endDate: '2026-08-01',
    })
    expect(result.success).toBe(false)
  })
})

describe('lineDescription', () => {
  it('says what the quantity means, so a vendor can check it', () => {
    expect(lineDescription(week(), 'hour')).toContain('hours')
    expect(lineDescription(week(), 'day')).toContain('days')
    expect(lineDescription(week(), 'month')).toContain('month')
  })
})

describe('serviceLines', () => {
  const august = [
    week({ id: 'a', weekStart: '2026-08-03', weekEnd: '2026-08-09', billableHours: 40 }),
    week({ id: 'b', weekStart: '2026-08-10', weekEnd: '2026-08-16', billableHours: 40 }),
    week({ id: 'c', weekStart: '2026-08-17', weekEnd: '2026-08-23', billableHours: 48 }),
    week({ id: 'd', weekStart: '2026-08-24', weekEnd: '2026-08-30', billableHours: 40 }),
  ]

  it('consolidates a month of hourly weeks into one line, the way the invoice reads', () => {
    const lines = serviceLines(august, 44, 'hour', { role: 'AI/ML Engineer', withName: false })
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(168)
    expect(lines[0].rate).toBe(44)
    expect(lines[0].unit).toBe('hour')
    expect(lines[0].description).toBe(
      'AI/ML Engineer Services rendered for the month of August-2026.\n\n' +
        'Service Period : ( August 3, 2026 - August 30, 2026 )'
    )
  })

  it('names the person when the invoice covers more than one', () => {
    const [line] = serviceLines(august, 44, 'hour', { role: null, withName: true })
    expect(line.description.startsWith('Alice Nguyen — Consulting Services')).toBe(true)
  })

  it('bills nothing for weeks with no billable hours', () => {
    expect(serviceLines([week({ billableHours: 0 })], 44, 'hour', { role: null, withName: false }))
      .toEqual([])
  })

  it('keeps per-week lines for flat-period placements', () => {
    expect(serviceLines(august, 9000, 'month', { role: null, withName: false })).toHaveLength(4)
  })
})

describe('servicePeriodLabel', () => {
  it('names the month a straddling period mostly falls in', () => {
    expect(servicePeriodLabel('2026-07-27', '2026-08-30')).toBe('the month of August-2026')
  })

  it('falls back to the period for a long span', () => {
    expect(servicePeriodLabel('2026-06-01', '2026-08-31')).toBe('the service period below')
  })
})

describe('monthServiceDescription', () => {
  it('words a manual month the way serviceLines words a month of timesheets', () => {
    expect(monthServiceDescription('AI/ML Engineer', '2026-08')).toBe(
      'AI/ML Engineer Services rendered for the month of August-2026.\n\n' +
        'Service Period : ( August 1, 2026 - August 31, 2026 )'
    )
  })

  it('knows February is short, and falls back to Consulting without a role', () => {
    expect(monthServiceDescription(null, '2026-02')).toContain('( February 1, 2026 - February 28, 2026 )')
    expect(monthServiceDescription('  ', '2026-02')).toMatch(/^Consulting Services/)
  })
})
