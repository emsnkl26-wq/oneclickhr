/**
 * Range, bucketing and totalling for the Finance overview.
 *
 * NO DIRECTIVE AT THE TOP: the server page computes everything here, and the
 * range picker reuses the preset vocabulary on the client.
 *
 * Dates are plain 'YYYY-MM-DD' strings in the TENANT'S timezone — "today" comes
 * from `todayIn(tz)` — and all arithmetic is done on UTC midnights of those
 * strings, so a server in another zone cannot shift a bucket by a day.
 *
 * MONEY IS SUMMED IN WHOLE CENTS, as in src/lib/expenses.ts, and rows in a
 * currency other than the workspace's are counted as `excluded`, never
 * converted.
 */

export type RangePreset =
  | 'this_month' | 'last_3_months' | 'this_year' | 'last_year' | 'last_12_months' | 'custom'

export const RANGE_LABELS: Record<RangePreset, string> = {
  this_month: 'This month',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  last_year: 'Last year',
  last_12_months: 'Last 12 months',
  custom: 'Custom range',
}

export const RANGE_PRESETS = Object.keys(RANGE_LABELS) as RangePreset[]

export interface ResolvedRange {
  preset: RangePreset
  from: string
  to: string
  prevFrom: string
  prevTo: string
  granularity: 'day' | 'month'
}

const ISO = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DAY = 86_400_000

const toMs = (date: string) => Date.parse(`${date}T00:00:00Z`)
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const addDays = (date: string, days: number) => fromMs(toMs(date) + days * DAY)

function monthStart(date: string, monthsBack = 0): string {
  const d = new Date(toMs(date))
  return fromMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1))
}

function isValidDate(value: string | undefined): value is string {
  return !!value && ISO.test(value) && !Number.isNaN(toMs(value)) && fromMs(toMs(value)) === value
}

/** Turn the URL's `range` / `from` / `to` into a concrete window. */
export function resolveRange(
  params: { range?: string; from?: string; to?: string },
  today: string
): ResolvedRange {
  let preset = (RANGE_PRESETS as string[]).includes(params.range ?? '')
    ? (params.range as RangePreset)
    : 'last_12_months'

  let from: string
  let to = today
  const year = today.slice(0, 4)

  switch (preset) {
    case 'this_month':
      from = monthStart(today)
      break
    case 'last_3_months':
      from = monthStart(today, 2)
      break
    case 'this_year':
      from = `${year}-01-01`
      break
    case 'last_year':
      from = `${Number(year) - 1}-01-01`
      to = `${Number(year) - 1}-12-31`
      break
    case 'custom':
      if (isValidDate(params.from) && isValidDate(params.to)) {
        ;[from, to] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from]
        // Five years of daily-or-monthly buckets is plenty; beyond that the
        // query is the thing that suffers, not the chart.
        if (toMs(to) - toMs(from) > 5 * 366 * DAY) from = addDays(to, -5 * 366)
        break
      }
      preset = 'last_12_months'
      from = monthStart(today, 11)
      break
    default:
      from = monthStart(today, 11)
  }

  // The comparison window is the same number of days immediately before.
  const days = Math.round((toMs(to) - toMs(from)) / DAY) + 1
  const prevTo = addDays(from, -1)
  const prevFrom = addDays(prevTo, -(days - 1))

  return { preset, from, to, prevFrom, prevTo, granularity: days <= 62 ? 'day' : 'month' }
}

/* ------------------------------------------------------------------ Totals */

export interface MoneyRow {
  /** 'YYYY-MM-DD' — the day the money moved. */
  date: string
  amount: number
  currency: string | null
  kind: 'earned' | 'expense' | 'payroll'
  category?: string
}

export interface FinancePoint {
  key: string
  label: string
  fullLabel: string
  earned: number
  expenses: number
  payroll: number
  spent: number
  net: number
  cumulative: number
}

export interface PeriodTotals {
  earned: number
  expenses: number
  payroll: number
  spent: number
  net: number
}

const cents = (value: number) => Math.round(value * 100)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function bucketKeys(range: ResolvedRange): Array<{ key: string; label: string; fullLabel: string }> {
  const out: Array<{ key: string; label: string; fullLabel: string }> = []
  if (range.granularity === 'day') {
    for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
      const month = MONTHS[Number(d.slice(5, 7)) - 1]
      out.push({
        key: d,
        label: `${Number(d.slice(8, 10))} ${month}`,
        fullLabel: `${Number(d.slice(8, 10))} ${month} ${d.slice(0, 4)}`,
      })
    }
  } else {
    let m = monthStart(range.from)
    const spansYears = range.from.slice(0, 4) !== range.to.slice(0, 4)
    while (m <= range.to) {
      const month = MONTHS[Number(m.slice(5, 7)) - 1]
      out.push({
        key: m.slice(0, 7),
        label: spansYears ? `${month} ${m.slice(2, 4)}` : month,
        fullLabel: `${month} ${m.slice(0, 4)}`,
      })
      const d = new Date(toMs(m))
      m = fromMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    }
  }
  return out
}

/** Sum rows inside [from, to], ignoring (and counting) other currencies. */
export function totalsFor(
  rows: MoneyRow[], from: string, to: string, currency: string
): PeriodTotals & { excluded: number } {
  const sum = { earned: 0, expense: 0, payroll: 0 }
  let excluded = 0
  for (const row of rows) {
    if (row.date < from || row.date > to) continue
    if (row.currency && row.currency !== currency) {
      excluded += 1
      continue
    }
    sum[row.kind] += cents(row.amount)
  }
  const spent = sum.expense + sum.payroll
  return {
    earned: sum.earned / 100,
    expenses: sum.expense / 100,
    payroll: sum.payroll / 100,
    spent: spent / 100,
    net: (sum.earned - spent) / 100,
    excluded,
  }
}

export function buildSeries(rows: MoneyRow[], range: ResolvedRange, currency: string): FinancePoint[] {
  const keys = bucketKeys(range)
  const index = new Map(keys.map((k, i) => [k.key, i]))
  const acc = keys.map(() => ({ earned: 0, expense: 0, payroll: 0 }))

  for (const row of rows) {
    if (row.date < range.from || row.date > range.to) continue
    if (row.currency && row.currency !== currency) continue
    const key = range.granularity === 'day' ? row.date : row.date.slice(0, 7)
    const i = index.get(key)
    if (i === undefined) continue
    acc[i][row.kind] += cents(row.amount)
  }

  let running = 0
  return keys.map((k, i) => {
    const { earned, expense, payroll } = acc[i]
    const net = earned - expense - payroll
    running += net
    return {
      ...k,
      earned: earned / 100,
      expenses: expense / 100,
      payroll: payroll / 100,
      spent: (expense + payroll) / 100,
      net: net / 100,
      cumulative: running / 100,
    }
  })
}

export function byCategory(rows: MoneyRow[], from: string, to: string, currency: string) {
  const map = new Map<string, number>()
  for (const row of rows) {
    if (row.kind === 'earned' || row.date < from || row.date > to) continue
    if (row.currency && row.currency !== currency) continue
    const key = row.kind === 'payroll' ? 'payroll' : row.category ?? 'other'
    map.set(key, (map.get(key) ?? 0) + cents(row.amount))
  }
  return [...map.entries()]
    .map(([category, value]) => ({ category, total: value / 100 }))
    .sort((a, b) => b.total - a.total)
}

/** Percent change, or null when there is nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / Math.abs(previous)) * 100
}
