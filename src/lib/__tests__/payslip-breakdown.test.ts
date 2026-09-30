import { describe, expect, it } from 'vitest'
import { pfEmployee, suggestBreakdown, sumLines } from '@/lib/payslip-breakdown'

describe('suggestBreakdown', () => {
  it('reproduces a standard Indian slip for a 58,200 gross', () => {
    const { earnings, deductions } = suggestBreakdown(58_200)
    expect(earnings.map((line) => line.amount)).toEqual([29_100, 14_550, 5_820, 1_600, 5_880, 1_250])
    expect(sumLines(earnings)).toBe(58_200)
    expect(deductions.map((line) => line.amount)).toEqual([1_800, 200, 0])
    expect(sumLines(deductions)).toBe(2_000)
  })

  it('never produces a negative allowance on a small gross', () => {
    const { earnings } = suggestBreakdown(5_000)
    expect(earnings.every((line) => line.amount >= 0)).toBe(true)
    expect(sumLines(earnings)).toBe(5_000)
  })

  it('leaves PF at zero when the employee has none', () => {
    const { deductions } = suggestBreakdown(58_200, { withPf: false })
    expect(deductions[0].amount).toBe(0)
  })
})

describe('pfEmployee', () => {
  it('is 12% of Basic, capped at the wage ceiling', () => {
    expect(pfEmployee(10_000)).toBe(1_200)
    expect(pfEmployee(29_100)).toBe(1_800)
    expect(pfEmployee(-5)).toBe(0)
  })
})
