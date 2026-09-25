import { describe, it, expect } from 'vitest'
import { eventDays } from '@/lib/calendar-kinds'
import { eventToMeetingFields } from '@/lib/google-calendar'
import { fromZonedInput } from '@/lib/time'
import { meetingSchema } from '@/lib/schemas'
import { navFor } from '@/components/shell/nav-config'

/**
 * The reported bug: a meeting set for 6:30 PM on 22 September by someone in
 * the US showed up on the 23rd. Timed events were placed on the grid by the
 * UTC date of their ISO string; they must go on the day they fall on in the
 * VIEWER's zone.
 */

const meeting = (start: string, end: string) => ({ start, end, allDay: false })

describe('eventDays — which grid cell a meeting lands in', () => {
  it('keeps a US evening meeting on its own day for a US viewer', () => {
    const start = fromZonedInput('2026-09-22T18:30', 'America/Los_Angeles')!
    const end = fromZonedInput('2026-09-22T19:30', 'America/Los_Angeles')!
    // 6:30 PM PDT is 01:30 UTC on the 23rd — the old bug's source.
    expect(start.slice(0, 10)).toBe('2026-09-23')
    expect(eventDays(meeting(start, end), 'America/Los_Angeles')).toEqual({
      first: '2026-09-22',
      last: '2026-09-22',
    })
  })

  it('shows the same instant on the next day for someone in India, correctly', () => {
    const start = fromZonedInput('2026-09-22T18:30', 'America/Los_Angeles')!
    const end = fromZonedInput('2026-09-22T19:30', 'America/Los_Angeles')!
    expect(eventDays(meeting(start, end), 'Asia/Kolkata').first).toBe('2026-09-23')
  })

  it('handles a New York evening meeting too', () => {
    const start = fromZonedInput('2026-09-22T18:30', 'America/New_York')!
    const end = fromZonedInput('2026-09-22T20:00', 'America/New_York')!
    expect(eventDays(meeting(start, end), 'America/New_York')).toEqual({
      first: '2026-09-22',
      last: '2026-09-22',
    })
  })

  it('does not spill onto the next day for a meeting ending exactly at midnight', () => {
    const start = fromZonedInput('2026-09-22T23:00', 'Asia/Kolkata')!
    const end = fromZonedInput('2026-09-23T00:00', 'Asia/Kolkata')!
    expect(eventDays(meeting(start, end), 'Asia/Kolkata')).toEqual({
      first: '2026-09-22',
      last: '2026-09-22',
    })
  })

  it('covers every day of an overnight meeting', () => {
    const start = fromZonedInput('2026-09-22T22:00', 'UTC')!
    const end = fromZonedInput('2026-09-23T02:00', 'UTC')!
    expect(eventDays(meeting(start, end), 'UTC')).toEqual({ first: '2026-09-22', last: '2026-09-23' })
  })

  it('never converts an all-day entry', () => {
    const allDay = { start: '2026-09-22', end: '2026-09-24', allDay: true }
    expect(eventDays(allDay, 'America/Los_Angeles')).toEqual({ first: '2026-09-22', last: '2026-09-24' })
    expect(eventDays(allDay, 'Pacific/Auckland')).toEqual({ first: '2026-09-22', last: '2026-09-24' })
  })
})

describe('eventToMeetingFields — Google all-day events (048)', () => {
  it('flags an all-day event and uses the inclusive last day', () => {
    const fields = eventToMeetingFields({
      id: 'x',
      summary: 'Offsite',
      start: { date: '2026-09-22' },
      end: { date: '2026-09-23' }, // Google's end.date is EXCLUSIVE
    })
    expect(fields.all_day).toBe(true)
    expect(fields.start_time).toBe('2026-09-22T00:00:00Z')
    expect(fields.end_time).toBe('2026-09-22T23:59:59Z')
  })

  it('keeps a multi-day all-day event to its real last day', () => {
    const fields = eventToMeetingFields({
      id: 'x',
      start: { date: '2026-09-22' },
      end: { date: '2026-09-25' },
    })
    expect(fields.end_time).toBe('2026-09-24T23:59:59Z')
  })

  it('leaves a timed event as the instants Google sent', () => {
    const fields = eventToMeetingFields({
      id: 'x',
      start: { dateTime: '2026-09-22T18:30:00-07:00' },
      end: { dateTime: '2026-09-22T19:30:00-07:00' },
    })
    expect(fields.all_day).toBe(false)
    expect(fields.start_time).toBe('2026-09-22T18:30:00-07:00')
  })
})

describe('meetingSchema timezone', () => {
  const base = {
    title: 'Sync',
    startTime: '2026-09-22T13:00:00.000Z',
    endTime: '2026-09-22T14:00:00.000Z',
  }

  it('accepts a real IANA zone', () => {
    expect(meetingSchema.safeParse({ ...base, timezone: 'America/Chicago' }).success).toBe(true)
  })

  it('refuses a made-up one, which would reach Google and the formatter verbatim', () => {
    expect(meetingSchema.safeParse({ ...base, timezone: 'Mars/Olympus_Mons' }).success).toBe(false)
  })
})

describe('one calendar, no separate meetings page', () => {
  it('is gone from both sidebars', () => {
    const hrefs = (role: 'org' | 'employee') =>
      navFor(role).flatMap((section) => section.items.map((item) => item.href))
    expect(hrefs('org')).toContain('/org/calendar')
    expect(hrefs('org')).not.toContain('/org/meetings')
    expect(hrefs('employee')).toContain('/employee/calendar')
    expect(hrefs('employee')).not.toContain('/employee/meetings')
  })
})
