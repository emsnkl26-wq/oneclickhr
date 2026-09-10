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
  billableHours: number
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
