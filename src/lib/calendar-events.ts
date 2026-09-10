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
 * genuine instants, stored as `timestamptz` and rendered in the workspace zone.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/*
 * The shared vocabulary lives in a directive-free module so the client grid can
 * import it too — see the header of src/lib/calendar-kinds.ts.
 *
 * Imported AND re-exported: `export … from` alone forwards the names without
 * binding them locally, and this file builds `CalendarEvent[]` itself.
 */
import type { CalendarEvent } from '@/lib/calendar-kinds'

export {
  EVENT_STYLES,
  type CalendarEvent,
  type CalendarEventKind,
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

export async function loadCalendarEvents(
  supabase: SupabaseClient,
  range: CalendarRange,
  options: { portal: 'org' | 'employee' }
): Promise<CalendarEvent[]> {
  const base = options.portal === 'org' ? '/org' : '/employee'

  /*
   * The instant bounds for the timed queries. A meeting late on the last day of
   * the range starts before `to`+1 day, so the upper bound is exclusive on the
   * following midnight rather than inclusive on `to` — otherwise the last day
   * of every month would silently lose its afternoon.
   */
  const fromInstant = `${range.from}T00:00:00.000Z`
  const toInstant = `${range.to}T23:59:59.999Z`

  /*
   * NO HOLIDAYS SOURCE. This product has no holiday calendar table, and a query
   * against one that does not exist would fail on every calendar load — a
   * pointless round trip and a permanent error in the logs. When holidays are
   * added, this is the one place that needs a sixth query and a `holiday` kind
   * (already defined in `EVENT_STYLES`, ready for it).
   */
  const [meetings, leaves, people, tasks] = await Promise.all([
    supabase
      .from('meetings')
      .select('id, title, start_time, end_time, location, cancelled_at')
      .gte('start_time', fromInstant)
      .lte('start_time', toInstant)
      .is('cancelled_at', null)
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

  for (const row of meetings.data ?? []) {
    events.push({
      id: `meeting-${row.id}`,
      kind: 'meeting',
      title: row.title,
      start: row.start_time,
      end: row.end_time,
      allDay: false,
      href: `${base}/meetings`,
      detail: row.location ?? null,
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
