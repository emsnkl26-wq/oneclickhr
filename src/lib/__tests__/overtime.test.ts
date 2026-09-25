import { describe, it, expect } from 'vitest'
import {
  decideOvertime, overtimeApplies, overtimeRate, payForWeek, payWithOvertime, serviceLines, splitHours,
} from '@/lib/billing'
import { computeTotals } from '@/lib/invoice'
import { assignmentSchema, reviewTimesheetSchema, tenantSettingsSchema } from '@/lib/schemas'

/**
 * Weekly overtime (049): billable hours above the threshold, approved by a
 * manager, paid and billed at a premium — and declined overtime neither paid
 * nor billed. The same split drives pay and invoice, so they are tested
 * together.
 */

describe('overtimeApplies', () => {
  it('only for an hourly, eligible placement', () => {
    expect(overtimeApplies('hour', true)).toBe(true)
    expect(overtimeApplies('hour', false)).toBe(false)
    expect(overtimeApplies('day', true)).toBe(false)
    expect(overtimeApplies('month', true)).toBe(false)
    expect(overtimeApplies('year', true)).toBe(false)
  })
})

describe('overtimeRate', () => {
  it('multiplies and rounds to the cent', () => {
    expect(overtimeRate(40, 1.5)).toBe(60)
    expect(overtimeRate(33.33, 1.5)).toBe(50)
    expect(overtimeRate(25.55, 2)).toBe(51.1)
  })

  it('never goes below the base rate for a nonsense multiplier', () => {
    expect(overtimeRate(40, 0.5)).toBe(40)
    expect(overtimeRate(40, Number.NaN)).toBe(40)
  })
})

describe('decideOvertime', () => {
  it('approves all of it by default', () => {
    expect(decideOvertime(5, undefined, true)).toBe(5)
    expect(decideOvertime(5, null, true)).toBe(5)
  })

  it('takes a smaller figure from the reviewer', () => {
    expect(decideOvertime(5, 2.5, true)).toBe(2.5)
    expect(decideOvertime(5, 0, true)).toBe(0)
  })

  it('can never approve MORE than was worked, or a negative amount', () => {
    expect(decideOvertime(5, 9, true)).toBe(5)
    expect(decideOvertime(5, -3, true)).toBe(0)
  })

  it('records nothing when overtime does not apply or there is none', () => {
    expect(decideOvertime(5, 5, false)).toBeNull()
    expect(decideOvertime(0, undefined, true)).toBeNull()
  })
})

describe('splitHours', () => {
  it('treats every hour as regular when overtime was not in play', () => {
    expect(splitHours(45, 5, null)).toEqual({ regular: 45, overtime: 0, declined: 0 })
  })

  it('moves approved overtime onto its own pile', () => {
    expect(splitHours(45, 5, 5)).toEqual({ regular: 40, overtime: 5, declined: 0 })
  })

  it('drops declined overtime from both piles', () => {
    expect(splitHours(45, 5, 2)).toEqual({ regular: 40, overtime: 2, declined: 3 })
    expect(splitHours(45, 5, 0)).toEqual({ regular: 40, overtime: 0, declined: 5 })
  })

  it('is safe against inconsistent input', () => {
    // More overtime than billable hours cannot produce negative regular hours.
    expect(splitHours(3, 10, 10).regular).toBe(0)
    expect(splitHours(-1, 0, null).regular).toBe(0)
  })
})

describe('payWithOvertime', () => {
  const base = { payRate: 20, unit: 'hour' as const, payMultiplier: 1.5 }

  it('pays regular at the rate and approved overtime at the premium', () => {
    const pay = payWithOvertime({ ...base, billableHours: 45, overtimeHours: 5, approvedOvertimeHours: 5 })
    expect(pay).toEqual({ regularHours: 40, overtimeHours: 5, regularPay: 800, overtimePay: 150, total: 950 })
  })

  it('does not pay declined overtime', () => {
    const pay = payWithOvertime({ ...base, billableHours: 45, overtimeHours: 5, approvedOvertimeHours: 0 })
    expect(pay?.total).toBe(800)
  })

  it('matches payForWeek exactly when there is no overtime', () => {
    const pay = payWithOvertime({ ...base, billableHours: 38, overtimeHours: 0, approvedOvertimeHours: null })
    expect(pay?.total).toBe(payForWeek(38, 20, 'hour'))
  })

  it('returns null without a pay rate — "not set" is not "earned nothing"', () => {
    expect(
      payWithOvertime({ ...base, payRate: null, billableHours: 45, overtimeHours: 5, approvedOvertimeHours: 5 })
    ).toBeNull()
  })
})

describe('serviceLines with overtime', () => {
  const week = (over: Record<string, unknown> = {}) => ({
    id: 'ts-1',
    code: 'TS-00001',
    weekStart: '2026-09-13',
    weekEnd: '2026-09-19',
    billableHours: 40,
    employeeName: 'Alice',
    ...over,
  })

  it('bills overtime on its own line at bill rate × the multiplier', () => {
    const lines = serviceLines(
      [week({ billableHours: 40, overtimeHours: 5 }), week({ id: 'ts-2', billableHours: 40, overtimeHours: 2 })],
      50,
      'hour',
      { role: 'Engineer', withName: false, overtimeMultiplier: 1.5 }
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ quantity: 80, rate: 50 })
    expect(lines[1]).toMatchObject({ quantity: 7, rate: 75 })
    expect(lines[1].description).toMatch(/Overtime/)
    // The invoice total is exactly the sum of the two lines.
    expect(computeTotals(lines, 0, 0).total).toBe(80 * 50 + 7 * 75)
  })

  it('adds no overtime line when there is none', () => {
    const lines = serviceLines([week()], 50, 'hour', { role: null, withName: false })
    expect(lines).toHaveLength(1)
  })

  it('never bills overtime on a non-hourly placement', () => {
    const lines = serviceLines([week({ overtimeHours: 5 })], 5000, 'month', { role: null, withName: false })
    expect(lines.every((l) => !/Overtime/.test(l.description))).toBe(true)
  })
})

describe('overtime inputs', () => {
  it('defaults a placement to eligible at 1.5×', () => {
    const parsed = assignmentSchema.parse({
      employeeId: '00000000-0000-4000-8000-000000000001',
      vendorId: '00000000-0000-4000-8000-000000000002',
      billRate: 50,
      payRate: 30,
    })
    expect(parsed.overtimeEligible).toBe(true)
    expect(parsed.overtimePayMultiplier).toBe(1.5)
    expect(parsed.overtimeBillMultiplier).toBe(1.5)
  })

  it('bounds the multipliers', () => {
    const base = {
      employeeId: '00000000-0000-4000-8000-000000000001',
      vendorId: '00000000-0000-4000-8000-000000000002',
    }
    expect(assignmentSchema.safeParse({ ...base, overtimePayMultiplier: 0.9 }).success).toBe(false)
    expect(assignmentSchema.safeParse({ ...base, overtimeBillMultiplier: 6 }).success).toBe(false)
  })

  it('accepts a review with an overtime figure, and refuses a negative one', () => {
    expect(reviewTimesheetSchema.safeParse({ status: 'approved', approvedOvertimeHours: 3 }).success).toBe(true)
    expect(reviewTimesheetSchema.safeParse({ status: 'approved', approvedOvertimeHours: -1 }).success).toBe(false)
  })

  it('lets a workspace switch overtime off with null, and bounds the threshold', () => {
    const settings = tenantSettingsSchema.partial()
    expect(settings.parse({ overtimeWeeklyThreshold: null }).overtimeWeeklyThreshold).toBeNull()
    expect(settings.safeParse({ overtimeWeeklyThreshold: 40 }).success).toBe(true)
    expect(settings.safeParse({ overtimeWeeklyThreshold: 0 }).success).toBe(false)
    expect(settings.safeParse({ overtimeWeeklyThreshold: 200 }).success).toBe(false)
    // Absent stays absent — the settings route must not touch the column.
    expect(settings.parse({}).overtimeWeeklyThreshold).toBeUndefined()
  })
})
