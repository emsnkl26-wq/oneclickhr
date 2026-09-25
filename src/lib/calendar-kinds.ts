/**
 * The calendar's vocabulary: what kinds of thing land on a date, what one looks
 * like, and how each is coloured.
 *
 * DELIBERATELY FREE OF BOTH DIRECTIVES — no `'use client'`, no `server-only`.
 *
 * That is the whole reason this is not simply the top of `calendar-events.ts`.
 * That module is `server-only` (it queries the database), and the GRID is a
 * client component that needs these same types and colours. Importing a
 * server-only module from a client one is a build error, and importing a client
 * module from a server one silently yields a reference proxy — so the shared
 * half lives here, where both may have it. Same arrangement, and the same
 * reason, as src/lib/job-form.ts.
 */

import { localDate } from '@/lib/time'

export type CalendarEventKind =
  | 'meeting'
  | 'leave'
  | 'holiday'
  | 'birthday'
  | 'anniversary'
  | 'task'
  | 'timesheet'

export interface CalendarEvent {
  id: string
  kind: CalendarEventKind
  title: string
  /** `YYYY-MM-DD` for all-day entries, an ISO instant for timed ones. */
  start: string
  end: string | null
  allDay: boolean
  /** Where clicking it goes, when there is somewhere to go. */
  href: string | null
  /** Extra line under the title. */
  detail?: string | null
  /**
   * The meeting itself, for `meeting` entries — so clicking one opens its
   * details (and, for an org, edit/delete) right on the calendar instead of
   * sending the person to another page.
   */
  meeting?: CalendarMeeting
}

export interface CalendarMeetingAttendee {
  email: string
  name?: string
  responseStatus?: string
}

/** The columns of a meeting the calendar's dialogs read. */
export interface CalendarMeeting {
  id: string
  title: string
  description: string | null
  location: string | null
  meet_link: string | null
  start_time: string
  end_time: string
  attendees: CalendarMeetingAttendee[]
  source: 'app' | 'google'
  read_only: boolean
  all_day: boolean
  google_event_id: string | null
  organizer_name: string | null
}

/**
 * One definition of each kind's colour and label, so the legend and the chips
 * in the grid cannot drift apart — they are the same lookup.
 */
export const EVENT_STYLES: Record<CalendarEventKind, { dot: string; chip: string; label: string }> = {
  meeting: { dot: 'bg-brand-600', chip: 'bg-brand-50 text-brand-700', label: 'Meetings' },
  leave: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700', label: 'Leave' },
  holiday: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700', label: 'Holidays' },
  birthday: { dot: 'bg-pink-500', chip: 'bg-pink-50 text-pink-700', label: 'Birthdays' },
  anniversary: {
    dot: 'bg-violet-500',
    chip: 'bg-violet-50 text-violet-700',
    label: 'Work anniversaries',
  },
  task: { dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700', label: 'Task due dates' },
  timesheet: { dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-700', label: 'Timesheets' },
}

/**
 * The first and last calendar day an event covers, in `timezone` — the
 * VIEWER's zone, which decides which cell of the grid a meeting sits in.
 *
 * All-day entries already are dates and are never converted. A timed one ends
 * on the day its LAST moment falls on: a meeting that runs until exactly
 * midnight does not spill onto the next day, so the end is nudged back one
 * millisecond before converting.
 */
export function eventDays(
  event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>,
  timezone: string
): { first: string; last: string } {
  if (event.allDay) {
    const first = event.start.slice(0, 10)
    const end = event.end ? event.end.slice(0, 10) : first
    return { first, last: end > first ? end : first }
  }
  const first = localDate(event.start, timezone)
  if (!event.end) return { first, last: first }
  const endMs = new Date(event.end).getTime() - 1
  if (!Number.isFinite(endMs)) return { first, last: first }
  const last = localDate(new Date(endMs), timezone)
  return { first, last: last > first ? last : first }
}
