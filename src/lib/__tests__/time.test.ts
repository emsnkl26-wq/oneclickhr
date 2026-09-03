import { describe, it, expect } from 'vitest'
import {
  localDate, isLateLogin, hoursBetween, daysUntil, inclusiveDays, weekDates,
  isValidTimezone, safeTimezone, formatDateLabel, formatInstantLabel,
} from '@/lib/time'

/**
 * The timezone rules that decide which day an attendance record belongs to and
 * when a visa reminder fires. Getting these wrong is silent: the app keeps
 * working and simply files things on the wrong date.
 */
describe('localDate', () => {
  it('files a late-evening UTC instant under the NEXT day in Asia/Kolkata', () => {
    // 2026-03-10 20:00 UTC is 2026-03-11 01:30 IST — a different calendar day.
    const instant = '2026-03-10T20:00:00Z'
    expect(localDate(instant, 'UTC')).toBe('2026-03-10')
    expect(localDate(instant, 'Asia/Kolkata')).toBe('2026-03-11')
  })

  it('files an early-morning UTC instant under the PREVIOUS day in New York', () => {
    // 2026-03-10 02:00 UTC is 2026-03-09 21:00 EST.
    const instant = '2026-03-10T02:00:00Z'
    expect(localDate(instant, 'UTC')).toBe('2026-03-10')
    expect(localDate(instant, 'America/New_York')).toBe('2026-03-09')
  })
})

describe('isLateLogin', () => {
  it('compares wall-clock time in the org timezone, not the server', () => {
    // 04:00 UTC is 09:30 IST — exactly on time for a 09:30 start.
    expect(isLateLogin('2026-03-10T04:00:00Z', '09:30', 'Asia/Kolkata')).toBe(false)
    // 04:01 UTC is 09:31 IST — one minute late.
    expect(isLateLogin('2026-03-10T04:01:00Z', '09:30', 'Asia/Kolkata')).toBe(true)
  })

  it('would give the opposite answer if the server timezone were used', () => {
    // The same instant is 04:00 in UTC — comfortably "early" against 09:30 —
    // which is precisely the bug this function exists to prevent.
    const instant = '2026-03-10T05:00:00Z' // 10:30 IST, genuinely late
    expect(isLateLogin(instant, '09:30', 'Asia/Kolkata')).toBe(true)
    expect(isLateLogin(instant, '09:30', 'UTC')).toBe(false)
  })

  it('handles a midnight start time', () => {
    expect(isLateLogin('2026-03-10T00:30:00Z', '00:00', 'UTC')).toBe(true)
  })
})

describe('daysUntil', () => {
  it('counts calendar days across a month boundary correctly', () => {
    // The classic off-by-one: Date.UTC takes a 0-indexed month, and passing the
    // 1-indexed value on both sides does NOT cancel out because months differ
    // in length. Aug 4 -> Sep 2 is 29 days, not 28.
    const today = new Date()
    const target = new Date(today)
    target.setDate(target.getDate() + 29)
    const iso = target.toISOString().slice(0, 10)
    expect(daysUntil(iso, 'UTC')).toBe(29)
  })

  it('returns 0 for today and a negative number for the past', () => {
    const today = new Date().toISOString().slice(0, 10)
    expect(daysUntil(today, 'UTC')).toBe(0)

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    expect(daysUntil(yesterday.toISOString().slice(0, 10), 'UTC')).toBe(-1)
  })

  it('hits each visa milestone exactly once', () => {
    for (const milestone of [90, 30, 7, 0]) {
      const target = new Date()
      target.setDate(target.getDate() + milestone)
      expect(daysUntil(target.toISOString().slice(0, 10), 'UTC')).toBe(milestone)
    }
  })
})

describe('inclusiveDays', () => {
  it('counts both ends — a single-day leave is 1, not 0', () => {
    expect(inclusiveDays('2026-03-10', '2026-03-10')).toBe(1)
    expect(inclusiveDays('2026-03-10', '2026-03-12')).toBe(3)
  })

  it('spans months without the 0-indexed month bug', () => {
    // Aug 30 -> Sep 2 inclusive is 4 days.
    expect(inclusiveDays('2026-08-30', '2026-09-02')).toBe(4)
    // Feb 27 -> Mar 1 in a non-leap year is 3 days.
    expect(inclusiveDays('2026-02-27', '2026-03-01')).toBe(3)
  })

  it('never returns less than 1', () => {
    expect(inclusiveDays('2026-03-12', '2026-03-10')).toBe(1)
  })
})

describe('hoursBetween', () => {
  it('rounds to two decimals', () => {
    expect(hoursBetween('2026-03-10T09:00:00Z', '2026-03-10T17:00:00Z')).toBe(8)
    expect(hoursBetween('2026-03-10T09:00:00Z', '2026-03-10T17:30:00Z')).toBe(8.5)
    expect(hoursBetween('2026-03-10T09:00:00Z', '2026-03-10T09:20:00Z')).toBe(0.33)
  })

  it('never returns a negative duration', () => {
    expect(hoursBetween('2026-03-10T17:00:00Z', '2026-03-10T09:00:00Z')).toBe(0)
  })
})

describe('weekDates', () => {
  it('returns Monday through Sunday', () => {
    // 2026-03-11 is a Wednesday.
    const days = weekDates('2026-03-11', 'UTC')
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-03-09') // Monday
    expect(days[6]).toBe('2026-03-15') // Sunday
  })

  it('treats Sunday as the END of its week, not the start', () => {
    const days = weekDates('2026-03-15', 'UTC') // a Sunday
    expect(days[0]).toBe('2026-03-09')
    expect(days[6]).toBe('2026-03-15')
  })
})

describe('timezone validation', () => {
  it('accepts real IANA zones and rejects nonsense', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true)
    expect(isValidTimezone('America/New_York')).toBe(true)
    expect(isValidTimezone('UTC')).toBe(true)
    expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false)
    expect(isValidTimezone('')).toBe(false)
  })

  it('falls back to the default rather than corrupting date maths', () => {
    expect(safeTimezone('Not/AZone')).toBe('Asia/Kolkata')
    expect(safeTimezone(null)).toBe('Asia/Kolkata')
    expect(safeTimezone('Europe/London')).toBe('Europe/London')
  })
})

/**
 * These exist because of a real bug on the jobs list.
 *
 * `published_at` is a `timestamptz` and was passed to `formatDateLabel`, which
 * is written for a plain `date`. It fell through its own guard and returned the
 * input unchanged, so the page rendered
 * `2026-09-03T05:56:56.566014+00:00` at the user, inside a table column and
 * again as a 28px stat number that overflowed its card.
 */
describe('date labels', () => {
  it('formats a plain date column', () => {
    expect(formatDateLabel('2026-09-03')).toBe('Sep 3, 2026')
    expect(formatDateLabel('2026-12-31')).toBe('Dec 31, 2026')
  })

  it('never renders a raw ISO timestamp at a user', () => {
    const label = formatDateLabel('2026-09-03T05:56:56.566014+00:00')
    expect(label).not.toContain('T05:56')
    expect(label).toBe('Sep 3, 2026')
  })

  it('shows an em dash for nothing rather than "null"', () => {
    expect(formatDateLabel(null)).toBe('—')
    expect(formatDateLabel(undefined)).toBe('—')
    expect(formatDateLabel('')).toBe('—')
  })

  it('does not invent a month from a malformed value', () => {
    // 13 is not a month: returning the input beats printing "undefined 3, 2026".
    expect(formatDateLabel('2026-13-03')).toBe('2026-13-03')
    expect(formatDateLabel('not-a-date')).toBe('not-a-date')
  })
})

describe('instant labels', () => {
  it('formats a timestamptz as a short calendar day', () => {
    expect(formatInstantLabel('2026-09-03T05:56:56.566014+00:00')).toBe('3 Sep 2026')
    expect(formatInstantLabel('2026-01-31T23:59:00Z')).toBe('31 Jan 2026')
  })

  it('reads the instant in UTC, so every viewer sees the same day', () => {
    // Same moment, two offsets. Both are 3 Sep in UTC and must agree.
    expect(formatInstantLabel('2026-09-03T00:30:00+00:00')).toBe('3 Sep 2026')
    expect(formatInstantLabel('2026-09-03T06:00:00+05:30')).toBe('3 Sep 2026')
  })

  it('handles null and garbage without throwing', () => {
    expect(formatInstantLabel(null)).toBe('—')
    expect(formatInstantLabel(undefined)).toBe('—')
    expect(formatInstantLabel('nonsense')).toBe('—')
  })
})
