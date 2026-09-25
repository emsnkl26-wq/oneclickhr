/**
 * How often someone is paid, and the pay periods that follows from (050).
 *
 *   monthly        one period per month               (India, and the default)
 *   semi_monthly   the 1st–15th, then the 16th–end   (the United States)
 *
 * Directive-free: the employee's upload list, the org's review screen and the
 * API that checks an upload all have to agree on which periods exist, so they
 * read it from one place.
 */

export const PAY_SCHEDULES = ['monthly', 'semi_monthly'] as const
export type PaySchedule = (typeof PAY_SCHEDULES)[number]

/** 0 = the whole month; 1 = the 1st–15th; 2 = the 16th to month end. */
export type PayPeriod = 0 | 1 | 2

export const PAY_SCHEDULE_LABELS: Record<PaySchedule, string> = {
  monthly: 'Monthly',
  semi_monthly: 'Twice a month (1st–15th, 16th–end)',
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Countries that pay twice a month by default. */
const SEMI_MONTHLY_COUNTRIES = new Set(['US'])

/**
 * The schedule that actually applies to somebody.
 *
 * An explicit choice wins. Otherwise the pay frequency given at onboarding,
 * when it names one of the two; otherwise their country; otherwise monthly.
 */
export function effectivePaySchedule(person: {
  pay_schedule?: string | null
  pay_frequency?: string | null
  country?: string | null
}): PaySchedule {
  if (person.pay_schedule === 'monthly' || person.pay_schedule === 'semi_monthly') {
    return person.pay_schedule
  }
  const frequency = (person.pay_frequency ?? '').toLowerCase().replace(/[^a-z]/g, '')
  if (frequency === 'semimonthly') return 'semi_monthly'
  if (frequency === 'monthly') return 'monthly'
  const country = (person.country ?? '').trim().toUpperCase()
  if (SEMI_MONTHLY_COUNTRIES.has(country) || /^united states/i.test(person.country ?? '')) {
    return 'semi_monthly'
  }
  return 'monthly'
}

/** The periods a month is divided into on this schedule. */
export function periodsOf(schedule: PaySchedule): PayPeriod[] {
  return schedule === 'semi_monthly' ? [1, 2] : [0]
}

export function isPeriodOf(schedule: PaySchedule, period: number): period is PayPeriod {
  return (periodsOf(schedule) as number[]).includes(period)
}

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** First and last calendar day of a period, `YYYY-MM-DD`. */
export function periodRange(
  year: number,
  month: number,
  period: PayPeriod
): { start: string; end: string } {
  const mm = String(month).padStart(2, '0')
  const startDay = period === 2 ? 16 : 1
  const endDay = period === 1 ? 15 : lastDayOf(year, month)
  return {
    start: `${year}-${mm}-${String(startDay).padStart(2, '0')}`,
    end: `${year}-${mm}-${String(endDay).padStart(2, '0')}`,
  }
}

/** "September 2026", "1–15 September 2026" or "16–30 September 2026". */
export function periodLabel(year: number, month: number, period: number): string {
  const name = `${MONTHS[month - 1] ?? ''} ${year}`
  if (period === 1) return `1–15 ${name}`
  if (period === 2) return `16–${lastDayOf(year, month)} ${name}`
  return name
}

/** Has this period begun, as of `today` (`YYYY-MM-DD`)? Uploads for later ones are refused. */
export function periodHasStarted(year: number, month: number, period: PayPeriod, today: string): boolean {
  return periodRange(year, month, period).start <= today
}

/**
 * The periods of the last `months` months up to `today`, newest first — the
 * list the employee works down. A period that has not begun yet is left out.
 */
export function recentPeriods(
  schedule: PaySchedule,
  today: string,
  months: number
): Array<{ year: number; month: number; period: PayPeriod }> {
  const [y, m] = today.split('-').map(Number)
  const out: Array<{ year: number; month: number; period: PayPeriod }> = []
  for (let back = 0; back < months; back += 1) {
    const date = new Date(Date.UTC(y, m - 1 - back, 1))
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + 1
    for (const period of [...periodsOf(schedule)].reverse()) {
      if (periodHasStarted(year, month, period, today)) out.push({ year, month, period })
    }
  }
  return out
}
