/**
 * Which dates a calendar view has to load.
 *
 * Directive-free so both the server pages and the client grid can agree on the
 * arithmetic — a range computed one way on the server and rendered another way
 * in the browser is how a calendar loses the first three days of a month.
 *
 * The month view draws SIX WHOLE WEEKS, so the range deliberately overshoots
 * the month at both ends: the last days of the previous month and the first of
 * the next are on screen, and events on them have to be fetched or those cells
 * lie about being empty.
 */

export type CalendarMode = 'month' | 'week'

function iso(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return iso(new Date(Date.UTC(y, m - 1, d + days)))
}

/** Sunday of the week containing `date`. Matches the grid's first column. */
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return addDays(date, -new Date(Date.UTC(y, m - 1, d)).getUTCDay())
}

/** `YYYY-MM-DD` today, in the workspace's timezone rather than the server's. */
export function todayInZone(timezone: string): string {
  // `en-CA` formats as YYYY-MM-DD, which is the shape used everywhere here.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** A `?date=` parameter, or today. Anything malformed falls back rather than throws. */
export function parseAnchor(value: string | undefined, timezone: string): string {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    // Rejects 2026-02-31 and friends: the round trip only survives a real date.
    if (iso(date) === value) return value
  }
  return todayInZone(timezone)
}

export function parseMode(value: string | undefined): CalendarMode {
  return value === 'week' ? 'week' : 'month'
}

/** The inclusive date range the grid will show for this anchor and mode. */
export function visibleRange(anchor: string, mode: CalendarMode): { from: string; to: string } {
  if (mode === 'week') {
    const from = weekStart(anchor)
    return { from, to: addDays(from, 6) }
  }
  const first = `${anchor.slice(0, 7)}-01`
  const from = weekStart(first)
  // 42 cells = six rows of seven, which is what the grid always draws.
  return { from, to: addDays(from, 41) }
}
