import { describe, it, expect } from 'vitest'
import {
  effectivePaySchedule, isPeriodOf, periodHasStarted, periodLabel, periodRange, periodsOf, recentPeriods,
} from '@/lib/pay-schedule'
import { paymentConfirmationSchema, updateEmployeeSchema } from '@/lib/schemas'

/** Monthly vs twice-monthly pay (050). */

describe('effectivePaySchedule', () => {
  it('honours an explicit choice first', () => {
    expect(effectivePaySchedule({ pay_schedule: 'monthly', country: 'US' })).toBe('monthly')
    expect(effectivePaySchedule({ pay_schedule: 'semi_monthly', country: 'IN' })).toBe('semi_monthly')
  })

  it('then the onboarding pay frequency', () => {
    expect(effectivePaySchedule({ pay_frequency: 'Semi-monthly', country: 'IN' })).toBe('semi_monthly')
    expect(effectivePaySchedule({ pay_frequency: 'Monthly', country: 'US' })).toBe('monthly')
  })

  it('then the country — US twice a month, India monthly', () => {
    expect(effectivePaySchedule({ country: 'US' })).toBe('semi_monthly')
    expect(effectivePaySchedule({ country: 'United States' })).toBe('semi_monthly')
    expect(effectivePaySchedule({ country: 'IN' })).toBe('monthly')
  })

  it('defaults to monthly, and ignores junk', () => {
    expect(effectivePaySchedule({})).toBe('monthly')
    expect(effectivePaySchedule({ pay_schedule: 'weekly', pay_frequency: 'Bi-weekly' })).toBe('monthly')
  })
})

describe('periods', () => {
  it('a monthly month is one period; a semi-monthly one is two', () => {
    expect(periodsOf('monthly')).toEqual([0])
    expect(periodsOf('semi_monthly')).toEqual([1, 2])
    expect(isPeriodOf('monthly', 1)).toBe(false)
    expect(isPeriodOf('semi_monthly', 0)).toBe(false)
  })

  it('splits the month at the 15th, whatever its length', () => {
    expect(periodRange(2026, 9, 1)).toEqual({ start: '2026-09-01', end: '2026-09-15' })
    expect(periodRange(2026, 9, 2)).toEqual({ start: '2026-09-16', end: '2026-09-30' })
    expect(periodRange(2028, 2, 2)).toEqual({ start: '2028-02-16', end: '2028-02-29' })
    expect(periodRange(2026, 12, 0)).toEqual({ start: '2026-12-01', end: '2026-12-31' })
  })

  it('labels each period plainly', () => {
    expect(periodLabel(2026, 9, 0)).toBe('September 2026')
    expect(periodLabel(2026, 9, 1)).toBe('1–15 September 2026')
    expect(periodLabel(2026, 2, 2)).toBe('16–28 February 2026')
  })

  it('does not offer the second half before the 16th', () => {
    expect(periodHasStarted(2026, 9, 2, '2026-09-15')).toBe(false)
    expect(periodHasStarted(2026, 9, 2, '2026-09-16')).toBe(true)
    expect(periodHasStarted(2026, 10, 1, '2026-09-30')).toBe(false)
  })

  it('lists recent periods newest first, only those that have begun', () => {
    expect(recentPeriods('semi_monthly', '2026-09-10', 2)).toEqual([
      { year: 2026, month: 9, period: 1 },
      { year: 2026, month: 8, period: 2 },
      { year: 2026, month: 8, period: 1 },
    ])
    expect(recentPeriods('monthly', '2026-01-05', 2)).toEqual([
      { year: 2026, month: 1, period: 0 },
      { year: 2025, month: 12, period: 0 },
    ])
  })
})

describe('schemas', () => {
  it('a confirmation defaults to the whole month and bounds the period', () => {
    const base = { month: 9, year: 2026, fileKey: 'tenant/x.pdf' }
    expect(paymentConfirmationSchema.parse(base).period).toBe(0)
    expect(paymentConfirmationSchema.safeParse({ ...base, period: 3 }).success).toBe(false)
  })

  it('an employee edit can set, clear or leave the schedule', () => {
    const base = { fullName: 'Asha Rao', timezone: 'Asia/Kolkata' }
    expect(updateEmployeeSchema.parse({ ...base, paySchedule: 'semi_monthly' }).paySchedule).toBe('semi_monthly')
    expect(updateEmployeeSchema.parse({ ...base, paySchedule: '' }).paySchedule).toBeNull()
    expect(updateEmployeeSchema.parse(base).paySchedule).toBeUndefined()
    expect(updateEmployeeSchema.safeParse({ ...base, paySchedule: 'weekly' }).success).toBe(false)
  })
})
