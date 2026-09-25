/**
 * Turning approved weeks into an invoice, and approved weeks into an employee's
 * pay. The two halves of the same arithmetic, kept together so they cannot
 * drift apart — and kept AWAY from each other in every other respect.
 *
 * THE ONE RULE THIS MODULE EXISTS TO HOLD
 * ---------------------------------------
 *     bill = billable hours × BILL rate   -> the vendor's invoice.  Org only.
 *     pay  = billable hours × PAY rate    -> the employee's share.  They see this.
 *
 * `billLines()` runs only on org-guarded routes. `payForWeek()` produces the
 * figure written onto the timesheet, which the employee CAN read. Nothing here
 * ever returns both to the same caller, and nothing that computes a bill amount
 * may be given a timesheet-shaped return value — see 022 and 023.
 *
 * Arithmetic goes through `lineAmount` / `computeTotals` in src/lib/invoice.ts
 * rather than being repeated here. Money is computed in whole cents there, and
 * a second implementation is how a printed total ends up a cent away from the
 * sum of its lines.
 */
import { lineAmount } from '@/lib/invoice'
import type { RateUnit } from '@/types/db'

/** A week, as far as billing is concerned. */
export interface BillableWeek {
  id: string
  code: string
  weekStart: string
  weekEnd: string
  /**
   * The hours billed at the ordinary rate. For a week with overtime (049) this
   * is the REGULAR part only — see `splitHours`.
   */
  billableHours: number
  /** Approved overtime hours, billed on their own line at the overtime rate. */
  overtimeHours?: number
  employeeName: string
}

export interface RatedLine {
  description: string
  quantity: number
  rate: number
}

/**
 * How many chargeable UNITS a week of hours represents.
 *
 * Only `hour` is a real conversion; the others are placements billed as a flat
 * period, where a week of any length is one week of that period. Dividing
 * monthly rates by hours worked would invent a precision the contract does not
 * have — a monthly placement is not cheaper because somebody took a Friday off.
 */
export function unitsFor(hours: number, unit: RateUnit): number {
  switch (unit) {
    case 'hour':
      return hours
    case 'day':
      // A standard working day. Deliberately not "hours logged / hours in a
      // day" per employee — day-rate contracts bill whole days.
      return round2(hours / 8)
    case 'month':
    case 'year':
      // A flat-period placement is invoiced per period, not per week, so a
      // single week is a fraction the caller has to decide on. Returning 0 here
      // would silently zero the invoice, so this is deliberately 1 and the
      // description says which week it covers.
      return 1
    default:
      return hours
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** How a line reads on the invoice. Names the person and the week, always. */
export function lineDescription(week: BillableWeek, unit: RateUnit): string {
  const period = `${week.weekStart} to ${week.weekEnd}`
  const basis =
    unit === 'hour' ? 'hours' : unit === 'day' ? 'days' : unit === 'month' ? 'month' : 'year'
  return `${week.employeeName} — ${period} (${week.code}, ${basis})`
}

/**
 * The invoice lines for a set of approved weeks at one bill rate.
 *
 * ORG-ONLY. `billRate` reaches this function from `employee_assignments`, which
 * an employee session cannot read at all.
 *
 * A week with no billable hours produces NO LINE rather than a zero one: an
 * invoice with "0.00" against somebody's name invites the vendor to ask what
 * went wrong, and the answer is nothing — they simply were not billable.
 */
export function billLines(
  weeks: BillableWeek[],
  billRate: number,
  unit: RateUnit
): RatedLine[] {
  return weeks
    .filter((week) => week.billableHours > 0)
    .map((week) => ({
      description: lineDescription(week, unit),
      quantity: unitsFor(week.billableHours, unit),
      rate: billRate,
    }))
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_MS = 86_400_000
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

/** `2026-08-01` → `August 1, 2026`. */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTH_NAMES[m - 1]} ${d}, ${y}`
}

/**
 * "the month of August-2026" when the weeks amount to one month's work, and a
 * plain "the period below" otherwise. Weekly timesheets straddle month ends
 * (Jul 27 – Aug 30 is August's billing), so the month is the one the period's
 * MIDPOINT falls in rather than the one it starts in.
 */
export function servicePeriodLabel(start: string, end: string): string {
  const span = (dayMs(end) - dayMs(start)) / DAY_MS
  if (span > 45) return 'the service period below'
  const mid = new Date(dayMs(start) + (span / 2) * DAY_MS)
  return `the month of ${MONTH_NAMES[mid.getUTCMonth()]}-${mid.getUTCFullYear()}`
}

export interface ServiceLine extends RatedLine {
  unit: RateUnit
}

/**
 * ONE invoice line for a placement's weeks, the way a staffing invoice states it:
 *
 *   AI/ML Engineer Services rendered for the month of August-2026.
 *
 *   Service Period : ( August 1, 2026 - August 31, 2026 )        168 hrs  $44/hr
 *
 * Hourly and daily placements sum their units into the one line. Monthly and
 * yearly placements have no meaningful sum of weeks, so they keep one line per
 * week from `billLines` — see `unitsFor`.
 *
 * `withName` prefixes the employee's name, for an invoice that covers more than
 * one person and would otherwise print two identical descriptions.
 */
export function serviceLines(
  weeks: BillableWeek[],
  billRate: number,
  unit: RateUnit,
  opts: { role: string | null; withName: boolean; overtimeMultiplier?: number }
): ServiceLine[] {
  const billable = weeks.filter((week) => week.billableHours > 0 || (week.overtimeHours ?? 0) > 0)
  if (!billable.length) return []

  if (unit !== 'hour' && unit !== 'day') {
    return billLines(billable, billRate, unit).map((line) => ({ ...line, unit }))
  }

  const start = billable.reduce((min, w) => (w.weekStart < min ? w.weekStart : min), billable[0].weekStart)
  const end = billable.reduce((max, w) => (w.weekEnd > max ? w.weekEnd : max), billable[0].weekEnd)
  const quantity = round2(billable.reduce((sum, w) => sum + unitsFor(w.billableHours, unit), 0))
  const role = opts.role?.trim() || 'Consulting'
  const prefix = opts.withName ? `${billable[0].employeeName} — ` : ''
  const period = `Service Period : ( ${longDate(start)} - ${longDate(end)} )`
  const overtime = round2(billable.reduce((sum, w) => sum + (w.overtimeHours ?? 0), 0))

  const lines: ServiceLine[] = []
  if (quantity > 0) {
    lines.push({
      description:
        `${prefix}${role} Services rendered for ${servicePeriodLabel(start, end)}.\n\n` + period,
      quantity,
      rate: billRate,
      unit,
    })
  }
  // Overtime only exists on hourly placements (049). It gets its own line so
  // the client sees the hours and the premium rate, not a blended average.
  if (overtime > 0 && unit === 'hour') {
    lines.push({
      description:
        `${prefix}${role} Overtime hours for ${servicePeriodLabel(start, end)}.\n\n` + period,
      quantity: overtime,
      rate: overtimeRate(billRate, opts.overtimeMultiplier ?? 1.5),
      unit,
    })
  }
  return lines
}

/**
 * What the EMPLOYEE earns from one approved week.
 *
 * Written onto the timesheet at approval and snapshotted there, so a rate
 * changed in March cannot rewrite what January's week said. Null in, null out:
 * a placement with no pay rate yields no figure at all, which is honest, where
 * a zero would read as "you earned nothing this week".
 */
export function payForWeek(
  billableHours: number,
  payRate: number | null,
  unit: RateUnit
): number | null {
  if (payRate === null || !Number.isFinite(payRate)) return null
  return lineAmount(unitsFor(billableHours, unit), payRate)
}

/**
 * The line a MANUAL invoice starts from — one calendar month, worded exactly
 * like `serviceLines` words a month of timesheets, so an invoice typed by hand
 * reads the same as one generated from approved weeks.
 *
 * `month` is `yyyy-mm`.
 */
export function monthServiceDescription(role: string | null, month: string): string {
  const [y, m] = month.split('-').map(Number)
  const start = `${month}-01`
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const end = `${month}-${String(lastDay).padStart(2, '0')}`
  return (
    `${role?.trim() || 'Consulting'} Services rendered for ${servicePeriodLabel(start, end)}.\n\n` +
    `Service Period : ( ${longDate(start)} - ${longDate(end)} )`
  )
}

/* ------------------------------------------------------------------ Overtime */

/**
 * Overtime only means something for an HOURLY placement whose person is owed
 * it (049). A day-, month- or year-rate placement has no hourly rate to
 * multiply, and an exempt employee is paid the same whatever the hours.
 */
export function overtimeApplies(unit: RateUnit, eligible: boolean): boolean {
  return unit === 'hour' && eligible
}

/** An overtime rate, rounded to the cent so `hours × rate` prints exactly. */
export function overtimeRate(rate: number, multiplier: number): number {
  const m = Number.isFinite(multiplier) && multiplier >= 1 ? multiplier : 1
  return round2(rate * m)
}

/**
 * How a week's billable hours divide once the manager has decided on its
 * overtime.
 *
 *   approvedOvertimeHours === null  → overtime was not in play (no overtime on
 *                                     the week, or it did not apply to this
 *                                     placement): every billable hour is
 *                                     regular, exactly as before 049.
 *   otherwise                       → the week's overtime hours come off the
 *                                     regular pile; the approved part of them
 *                                     is paid/billed at the overtime rate and
 *                                     the declined part not at all.
 *
 * Pay and invoice both read the split from here, so an hour can never be paid
 * as overtime and billed as regular.
 */
export function splitHours(
  billableHours: number,
  overtimeHours: number,
  approvedOvertimeHours: number | null
): { regular: number; overtime: number; declined: number } {
  const billable = Math.max(0, billableHours || 0)
  if (approvedOvertimeHours === null) return { regular: round2(billable), overtime: 0, declined: 0 }
  const ot = Math.min(billable, Math.max(0, overtimeHours || 0))
  const approved = Math.min(ot, Math.max(0, approvedOvertimeHours))
  return {
    regular: round2(billable - ot),
    overtime: round2(approved),
    declined: round2(ot - approved),
  }
}

/**
 * The approved-overtime figure to record when a week is approved: null when
 * overtime does not apply, else the reviewer's choice clamped to what the week
 * actually has (defaulting to all of it).
 */
export function decideOvertime(
  overtimeHours: number,
  requested: number | null | undefined,
  applies: boolean
): number | null {
  const ot = Math.max(0, overtimeHours || 0)
  if (!applies || ot <= 0) return null
  if (requested === null || requested === undefined || !Number.isFinite(requested)) return round2(ot)
  return round2(Math.min(ot, Math.max(0, requested)))
}

export interface WeekPay {
  regularHours: number
  overtimeHours: number
  regularPay: number
  overtimePay: number
  total: number
}

/**
 * What the employee earns from an approved week, overtime included. Null when
 * the placement carries no pay rate — see `payForWeek`.
 */
export function payWithOvertime(args: {
  billableHours: number
  overtimeHours: number
  approvedOvertimeHours: number | null
  payRate: number | null
  unit: RateUnit
  payMultiplier: number
}): WeekPay | null {
  const { payRate, unit } = args
  if (payRate === null || !Number.isFinite(payRate)) return null
  const split = splitHours(args.billableHours, args.overtimeHours, args.approvedOvertimeHours)
  const regularPay = lineAmount(unitsFor(split.regular, unit), payRate)
  const overtimePay = split.overtime
    ? lineAmount(split.overtime, overtimeRate(payRate, args.payMultiplier))
    : 0
  return {
    regularHours: split.regular,
    overtimeHours: split.overtime,
    regularPay,
    overtimePay,
    total: round2(regularPay + overtimePay),
  }
}
