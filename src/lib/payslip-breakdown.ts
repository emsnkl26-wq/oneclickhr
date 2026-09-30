/**
 * The itemised salary slip Indian employers issue: earnings split into Basic,
 * HRA and allowances, and statutory deductions — PF, Professional Tax, TDS.
 *
 * Plain data and arithmetic, shared by the payslip form, the PDF renderer and
 * the API schema, so there is one list of components and one way to add them up.
 */

export interface PayslipLine {
  label: string
  amount: number
}

/** What a detailed slip prints beyond the simple one. */
export interface PayslipBreakdown {
  employeeCode: string
  dateOfJoining: string
  pfNumber: string
  bankDetails: string
  earnings: PayslipLine[]
  deductions: PayslipLine[]
}

export const EARNING_LABELS = [
  'Basic',
  'HRA',
  'City Compensatory Allowance',
  'Conveyance',
  'Special Allowance',
  'Medical',
] as const

export const DEDUCTION_LABELS = ['PF Employee', 'Professional Tax', 'TDS'] as const

/** EPF is 12% of Basic, on Basic capped at the statutory wage ceiling. */
export const PF_RATE = 0.12
export const PF_WAGE_CEILING = 15_000

const round2 = (value: number) => Math.round(value * 100) / 100

export function sumLines(lines: PayslipLine[]): number {
  return round2(lines.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0))
}

/** Employee PF on a month's Basic: 12% of Basic, capped at the wage ceiling. */
export function pfEmployee(basic: number): number {
  return Math.round(Math.min(Math.max(basic, 0), PF_WAGE_CEILING) * PF_RATE)
}

/**
 * A conventional split of a monthly gross, as a starting point the org edits:
 *
 *   Basic 50% · HRA 50% of Basic · City Compensatory 10% · Conveyance 1,600 ·
 *   Medical 1,250 · Special Allowance = whatever is left.
 *
 * The two fixed allowances shrink when the gross is too small to carry them, so
 * Special Allowance never goes negative and the lines always add up to the gross.
 * With `withPf`, PF is 12% of Basic up to the ceiling; Professional Tax defaults
 * to 200 (the usual monthly slab — it varies by state, and the field is editable).
 */
export function suggestBreakdown(
  monthlyGross: number,
  { withPf = true }: { withPf?: boolean } = {}
): Pick<PayslipBreakdown, 'earnings' | 'deductions'> {
  const gross = Math.max(0, round2(monthlyGross))
  const basic = round2(gross * 0.5)
  const hra = round2(basic * 0.5)
  const cca = round2(gross * 0.1)
  let remaining = round2(gross - basic - hra - cca)
  const conveyance = Math.min(1600, Math.max(remaining, 0))
  remaining = round2(remaining - conveyance)
  const medical = Math.min(1250, Math.max(remaining, 0))
  const special = round2(remaining - medical)

  // In EARNING_LABELS order.
  const amounts = [basic, hra, cca, conveyance, special, medical]
  return {
    earnings: EARNING_LABELS.map((label, index) => ({ label, amount: amounts[index] })),
    deductions: [
      { label: 'PF Employee', amount: withPf ? pfEmployee(basic) : 0 },
      { label: 'Professional Tax', amount: gross > 0 ? 200 : 0 },
      { label: 'TDS', amount: 0 },
    ],
  }
}
