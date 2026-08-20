/**
 * Timezone-correct date logic.
 *
 * Every instant in the database is `timestamptz` (UTC). But three decisions in
 * this product are about a CALENDAR DAY, and a calendar day only exists inside a
 * timezone:
 *
 *   • which attendance row a clock-in belongs to,
 *   • whether that clock-in was "late",
 *   • how many days remain before a visa expires.
 *
 * All three are evaluated in the ORG's timezone (`tenants.timezone`, default
 * Asia/Kolkata), never the server's. A Vercel lambda runs in UTC, so a Mumbai
 * team clocking in at 09:00 IST would otherwise be filed under the PREVIOUS day
 * — the attendance grid would be quietly wrong for every morning shift.
 */
import { formatInTimeZone, toZonedTime, fromZonedTime } from 'date-fns-tz'

export const DEFAULT_TIMEZONE = 'Asia/Kolkata'

/** Is this an IANA zone Node can actually resolve? Guards user-supplied values. */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function safeTimezone(tz: string | null | undefined): string {
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE
}

/** The local calendar day (`YYYY-MM-DD`) an instant falls on, in `tz`. */
export function localDate(instant: Date | string, tz: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  return formatInTimeZone(d, safeTimezone(tz), 'yyyy-MM-dd')
}

/** "Today" in the org's timezone. */
export function todayIn(tz: string): string {
  return localDate(new Date(), tz)
}

/** Local wall-clock time (`HH:mm`) of an instant, in `tz`. */
export function localTime(instant: Date | string, tz: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  return formatInTimeZone(d, safeTimezone(tz), 'HH:mm')
}

export function formatLocal(instant: Date | string, tz: string, pattern = 'd MMM yyyy, HH:mm'): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(d.getTime())) return '—'
  return formatInTimeZone(d, safeTimezone(tz), pattern)
}

/**
 * Was a clock-in late relative to the org's configured start time?
 *
 * Both sides are reduced to minutes-since-midnight IN THE ORG'S ZONE, so this is
 * a pure local-wall-clock comparison and never drifts with DST or with wherever
 * the server happens to run.
 */
export function isLateLogin(
  loginInstant: Date | string,
  workStartTime: string,
  tz: string
): boolean {
  const [startH, startM] = (workStartTime || '09:30').split(':').map((n) => parseInt(n, 10))
  if (!Number.isFinite(startH)) return false

  const local = localTime(loginInstant, tz)
  const [h, m] = local.split(':').map((n) => parseInt(n, 10))

  return h * 60 + m > startH * 60 + (Number.isFinite(startM) ? startM : 0)
}

/** Whole hours between two instants, rounded to 2dp. Never negative. */
export function hoursBetween(start: Date | string, end: Date | string): number {
  const a = typeof start === 'string' ? new Date(start) : start
  const b = typeof end === 'string' ? new Date(end) : end
  const ms = b.getTime() - a.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round((ms / 3_600_000) * 100) / 100
}

/**
 * Convert `YYYY-MM-DD` to a UTC epoch for pure day arithmetic.
 *
 * The month MUST be decremented: `Date.UTC` takes a 0-indexed month. Passing the
 * 1-indexed value on both sides of a subtraction does not cancel out, because
 * months have different lengths — 2026-08-04 to 2026-09-02 would come out as 28
 * days instead of 29, which is exactly the kind of off-by-one that makes a visa
 * reminder fire on the wrong day.
 */
function dayEpoch(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1)
}

/**
 * Whole days from today until `expiryDate`, counted in the org's timezone.
 *
 * This is the visa engine's milestone test, and it must be a DAY difference, not
 * an hours/24 division: an expiry at 23:00 local and one at 01:00 local on the
 * same date are both "that day". Comparing local midnights makes it exact.
 */
export function daysUntil(expiryDate: string, tz: string): number {
  return Math.round((dayEpoch(expiryDate) - dayEpoch(todayIn(tz))) / 86_400_000)
}

/**
 * Shift a `YYYY-MM-DD` date by whole days, staying a `YYYY-MM-DD`.
 *
 * Calendar arithmetic on the date only, via `dayEpoch`, so it is immune to the
 * DST hour that breaks `+ n * 86_400_000` on a local `Date`. Use it to build the
 * bounds of a range filter — a horizon the DATABASE can apply with an index,
 * rather than fetching rows and rejecting them afterwards.
 */
export function addDays(date: string, days: number): string {
  return new Date(dayEpoch(date) + days * 86_400_000).toISOString().slice(0, 10)
}

/** Start-of-day instant for a local date — for building timestamptz range filters. */
export function startOfLocalDay(date: string, tz: string): Date {
  return fromZonedTime(`${date}T00:00:00`, safeTimezone(tz))
}

/** Exclusive end-of-day instant for a local date. */
export function endOfLocalDay(date: string, tz: string): Date {
  const next = new Date(startOfLocalDay(date, tz))
  next.setUTCDate(next.getUTCDate() + 1)
  return next
}

/** Monday..Sunday local dates for the week containing `date`. */
export function weekDates(date: string, tz: string): string[] {
  const anchor = toZonedTime(startOfLocalDay(date, tz), safeTimezone(tz))
  const dow = (anchor.getDay() + 6) % 7 // Monday = 0
  const monday = new Date(anchor)
  monday.setDate(anchor.getDate() - dow)

  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`
  })
}

/** Inclusive day count between two local dates — what a leave request means. */
export function inclusiveDays(start: string, end: string): number {
  return Math.max(1, Math.round((dayEpoch(end) - dayEpoch(start)) / 86_400_000) + 1)
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
