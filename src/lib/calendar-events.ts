import 'server-only'

/**
 * Everything that happens on a date, from every part of the product, as one
 * list of comparable things.
 *
 * WHY ONE LOADER. A calendar that only knows about meetings is a worse meetings
 * list. What makes it worth opening is that leave, holidays, birthdays and
 * deadlines are on the SAME grid — "can we meet on the 14th" is unanswerable
 * without them. So every source is normalised here into one shape, and the grid
 * component never learns what a timesheet is.
 *
 * RLS DOES THE SCOPING, not this module. Each query runs on the CALLER's client,
 * so an employee's calendar returns their own leave and their own tasks because
 * the policies say so — there is no `if (role === 'employee')` here to get
 * wrong. The one exception is birthdays, which are read from `profiles` and are
 * therefore visible workspace-wide by the same policy that powers the employee
 * directory.
 *
 * DATES, NOT INSTANTS, for anything all-day. Leave, holidays and birthdays are
 * calendar facts: a birthday is the 14th everywhere on earth, and converting it
 * through a timezone would move it for somebody. Meetings are the opposite —
 * genuine instants, stored as `timestamptz` and placed on the grid by the day
 * they fall on in the VIEWER's zone (see calendar-view.tsx).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { startOfLocalDay, endOfLocalDay } from '@/lib/time'

/*
 * The shared vocabulary lives in a directive-free module so the client grid can
 * import it too — see the header of src/lib/calendar-kinds.ts.
 *
 * Imported AND re-exported: `export … from` alone forwards the names without
 * binding them locally, and this file builds `CalendarEvent[]` itself.
 */
import type { CalendarEvent, CalendarMeeting } from '@/lib/calendar-kinds'

export {
  EVENT_STYLES,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarMeeting,
} from '@/lib/calendar-kinds'

export interface CalendarRange {
  /** Inclusive `YYYY-MM-DD`. */
  from: string
  /** Inclusive `YYYY-MM-DD`. */
  to: string
}

/**
 * An annual date (birthday, joining date) projected into the year(s) the view
 * covers.
 *
 * A range can straddle a year boundary — the grid always shows the tail of the
 * previous month and the head of the next — so BOTH candidate years are tested
 * rather than just the range's start.
 */
function annualOccurrences(monthDay: string, range: CalendarRange): string[] {
  const startYear = Number(range.from.slice(0, 4))
  const endYear = Number(range.to.slice(0, 4))
  const out: string[] = []
  for (let year = startYear; year <= endYear; year += 1) {
    const date = `${year}-${monthDay}`
    if (date >= range.from && date <= range.to) out.push(date)
  }
  return out
}

interface MeetingRow {
  id: string
  title: string
  description: string | null
  location: string | null
  meet_link: string | null
  start_time: string
  end_time: string
  attendees: CalendarMeeting['attendees'] | null
  source: 'app' | 'google'
  read_only: boolean
  all_day: boolean | null
  google_event_id: string | null
  organizer: { full_name: string | null } | null
}

/** The columns every meeting surface reads — the grid, the agenda and the dialogs. */
export const MEETING_COLUMNS =
  'id, title, description, location, meet_link, start_time, end_time, attendees, source, read_only, all_day, google_event_id, ' +
  'organizer:profiles!meetings_organizer_id_fkey(full_name)'

/** A `meetings` row, as selected with `MEETING_COLUMNS`, in the calendar's shape. */
export function toCalendarMeeting(raw: unknown): CalendarMeeting {
  const row = raw as MeetingRow
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    meet_link: row.meet_link,
    start_time: row.start_time,
    end_time: row.end_time,
    attendees: Array.isArray(row.attendees) ? row.attendees : [],
    source: row.source,
    read_only: row.read_only,
    all_day: !!row.all_day,
    google_event_id: row.google_event_id,
    organizer_name: row.organizer?.full_name ?? null,
  }
}

export async function loadCalendarEvents(
  supabase: SupabaseClient,
  range: CalendarRange,
  options: {
    portal: 'org' | 'employee'
    /**
     * The zone the grid is drawn in — the VIEWER's. The range is a run of
     * calendar days in this zone, so the timed query is bounded by this zone's
     * midnights, not UTC's.
     */
    timezone: string
  }
): Promise<CalendarEvent[]> {
  const base = options.portal === 'org' ? '/org' : '/employee'

  /*
   * The instant bounds for the meeting query: the first visible day's midnight
   * and the midnight AFTER the last visible day, both in the viewer's zone.
   *
   * These used to be UTC midnights, which for anyone west of Greenwich dropped
   * the evening of the last visible day. One extra day is fetched on each side
   * so an all-day Google event (stored on a UTC midnight, 048) is never lost at
   * an edge — the grid places every row by its own date and ignores whatever
   * falls off screen.
   */
  const fromInstant = startOfLocalDay(range.from, options.timezone)
  fromInstant.setUTCDate(fromInstant.getUTCDate() - 1)
  const toInstant = endOfLocalDay(range.to, options.timezone)
  toInstant.setUTCDate(toInstant.getUTCDate() + 1)

  /*
   * NO HOLIDAYS SOURCE. This product has no holiday calendar table, and a query
   * against one that does not exist would fail on every calendar load — a
   * pointless round trip and a permanent error in the logs. When holidays are
   * added, this is the one place that needs another query and a `holiday` kind
   * (already defined in `EVENT_STYLES`, ready for it).
   */
  const [meetings, leaves, people, tasks] = await Promise.all([
    supabase
      .from('meetings')
      .select(MEETING_COLUMNS)
      // OVERLAPPING the window rather than starting in it, so an event that
      // began before the first visible day still shows on the days it covers.
      .lt('start_time', toInstant.toISOString())
      .gte('end_time', fromInstant.toISOString())
      .is('cancelled_at', null)
      .order('start_time', { ascending: true })
      .limit(500),
    supabase
      .from('leaves')
      .select('id, start_date, end_date, status, reason, employee:profiles!leaves_employee_id_fkey(full_name)')
      .lte('start_date', range.to)
      .gte('end_date', range.from)
      .eq('status', 'approved')
      .limit(500),
    supabase
      .from('profiles')
      .select('id, full_name, date_of_birth, date_of_joining')
      .eq('is_active', true)
      .limit(500),
    supabase
      .from('tasks')
      .select('id, title, due_date')
      .gte('due_date', range.from)
      .lte('due_date', range.to)
      .limit(500),
  ])

  const events: CalendarEvent[] = []

  for (const raw of meetings.data ?? []) {
    const meeting = toCalendarMeeting(raw)
    events.push({
      id: `meeting-${meeting.id}`,
      kind: 'meeting',
      title: meeting.title,
      // An all-day Google event is a pair of DATES written as UTC midnights, so
      // the date half is read straight off and never converted (048).
      start: meeting.all_day ? meeting.start_time.slice(0, 10) : meeting.start_time,
      end: meeting.all_day ? meeting.end_time.slice(0, 10) : meeting.end_time,
      allDay: meeting.all_day,
      // Opened in a dialog on the calendar itself, not by navigating away.
      href: null,
      detail: meeting.location ?? null,
      meeting,
    })
  }

  for (const row of (leaves.data ?? []) as unknown as Array<{
    id: string
    start_date: string
    end_date: string
    reason: string | null
    employee: { full_name: string | null } | null
  }>) {
    events.push({
      id: `leave-${row.id}`,
      kind: 'leave',
      // On the employee's own calendar the name would be their own on every
      // row, so it is only worth the space in the org view.
      title:
        options.portal === 'org'
          ? `${row.employee?.full_name ?? 'Someone'} — leave`
          : 'On leave',
      start: row.start_date,
      end: row.end_date,
      allDay: true,
      href: `${base}/leaves`,
      detail: row.reason,
    })
  }

  for (const row of (people.data ?? []) as unknown as Array<{
    id: string
    full_name: string | null
    date_of_birth: string | null
    date_of_joining: string | null
  }>) {
    const name = row.full_name || 'A colleague'

    if (row.date_of_birth) {
      for (const date of annualOccurrences(row.date_of_birth.slice(5), range)) {
        events.push({
          id: `birthday-${row.id}-${date}`,
          kind: 'birthday',
          title: `${name}'s birthday`,
          start: date,
          end: null,
          allDay: true,
          href: options.portal === 'org' ? `/org/employees/${row.id}` : null,
        })
      }
    }

    if (row.date_of_joining) {
      const joinYear = Number(row.date_of_joining.slice(0, 4))
      for (const date of annualOccurrences(row.date_of_joining.slice(5), range)) {
        const years = Number(date.slice(0, 4)) - joinYear
        // The joining day itself is not an anniversary of anything yet.
        if (years < 1) continue
        events.push({
          id: `anniversary-${row.id}-${date}`,
          kind: 'anniversary',
          title: `${name} — ${years} ${years === 1 ? 'year' : 'years'}`,
          start: date,
          end: null,
          allDay: true,
          href: options.portal === 'org' ? `/org/employees/${row.id}` : null,
        })
      }
    }
  }

  for (const row of tasks.data ?? []) {
    events.push({
      id: `task-${row.id}`,
      kind: 'task',
      title: row.title,
      start: row.due_date,
      end: null,
      allDay: true,
      href: options.portal === 'org' ? '/org/board' : '/employee/tasks',
    })
  }

  return events
}

/**
 * The next meetings from now — the agenda beside the grid, independent of the
 * month on screen. Still running counts as upcoming, so a meeting in progress
 * keeps its Join button.
 */
export async function loadUpcomingMeetings(
  supabase: SupabaseClient,
  limit = 12
): Promise<CalendarMeeting[]> {
  const { data } = await supabase
    .from('meetings')
    .select(MEETING_COLUMNS)
    .is('cancelled_at', null)
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(limit)
  return (data ?? []).map(toCalendarMeeting)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * One meeting by id, for `?meeting=` — where a notification lands. Read on the
 * caller's client, so RLS decides whether they may see it; anything malformed
 * or out of reach is simply null.
 */
export async function loadMeetingById(
  supabase: SupabaseClient,
  id: string | undefined
): Promise<CalendarMeeting | null> {
  if (!id || !UUID_RE.test(id)) return null
  const { data } = await supabase
    .from('meetings')
    .select(MEETING_COLUMNS)
    .eq('id', id)
    .is('cancelled_at', null)
    .maybeSingle()
  return data ? toCalendarMeeting(data) : null
}
