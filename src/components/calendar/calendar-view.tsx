'use client'

/**
 * The month and week grid.
 *
 * BUILT IN HOUSE, on a CSS grid. A calendar library would bring its own styling
 * system, its own date library and about 80KB, to draw seven columns and handle
 * "which cell does this fall in" — which is the arithmetic below, and it is
 * short.
 *
 * DATES ARE STRINGS HERE, NOT `Date` OBJECTS. Every cell is a `YYYY-MM-DD` key
 * and every all-day event carries one, so placing an event is a map lookup
 * rather than a timezone conversion. `new Date('2026-09-14')` is midnight UTC,
 * which in the Americas is the 13th — the classic way a calendar puts a
 * birthday on the wrong day. Only genuinely timed events (meetings) are ever
 * converted, and only to read the clock off them.
 *
 * The month view always shows whole weeks, so the first and last rows spill
 * into the neighbouring months. Those cells are dimmed rather than blanked:
 * "nothing happens on the 1st" and "the 1st is not on this screen" have to look
 * different or people stop trusting the grid.
 */

import * as React from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EVENT_STYLES, type CalendarEvent, type CalendarEventKind } from '@/lib/calendar-kinds'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** `YYYY-MM-DD` for a UTC-safe date, built from parts rather than parsed. */
function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  // UTC throughout: the only thing being computed is a calendar offset, and
  // local time would drift it by a day around DST.
  const next = new Date(Date.UTC(y, m - 1, d + days))
  return iso(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate())
}

/** Sunday of the week containing `date`. */
function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDaysIso(date, -weekday)
}

/** Every date a multi-day event covers, clamped to what is on screen. */
function spanDates(event: CalendarEvent, from: string, to: string): string[] {
  if (!event.allDay) return [event.start.slice(0, 10)]
  const out: string[] = []
  let cursor = event.start < from ? from : event.start
  const last = event.end && event.end > event.start ? event.end : event.start
  const stop = last > to ? to : last
  // Bounded by the visible range, so a mistyped multi-year leave request cannot
  // spin here.
  while (cursor <= stop && out.length < 400) {
    out.push(cursor)
    cursor = addDaysIso(cursor, 1)
  }
  return out
}

export type CalendarMode = 'month' | 'week'

export function CalendarView({
  events, anchor, mode, today, onNavigate, onModeChange, timezone,
}: {
  events: CalendarEvent[]
  /** Any date inside the period being shown, `YYYY-MM-DD`. */
  anchor: string
  mode: CalendarMode
  today: string
  onNavigate: (nextAnchor: string) => void
  onModeChange: (mode: CalendarMode) => void
  timezone: string
}) {
  const [hidden, setHidden] = React.useState<Set<CalendarEventKind>>(new Set())

  const [anchorYear, anchorMonth] = anchor.split('-').map(Number)

  /** The visible cells, and the label above them. */
  const { cells, title } = React.useMemo(() => {
    if (mode === 'week') {
      const start = weekStart(anchor)
      const days = Array.from({ length: 7 }, (_, index) => addDaysIso(start, index))
      return {
        cells: days.map((date) => ({ date, muted: false })),
        title: `Week of ${formatDay(days[0])}`,
      }
    }

    const first = iso(anchorYear, anchorMonth - 1, 1)
    const gridStart = weekStart(first)
    // Six rows always: a month can span six weeks, and a grid that changes
    // height as you page through the year is disorienting.
    const days = Array.from({ length: 42 }, (_, index) => addDaysIso(gridStart, index))
    return {
      cells: days.map((date) => ({
        date,
        muted: Number(date.slice(5, 7)) !== anchorMonth,
      })),
      title: monthLabel(anchorYear, anchorMonth),
    }
  }, [anchor, anchorMonth, anchorYear, mode])

  const from = cells[0].date
  const to = cells[cells.length - 1].date

  /** date -> events, computed once per render rather than per cell. */
  const byDate = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      if (hidden.has(event.kind)) continue
      for (const date of spanDates(event, from, to)) {
        const list = map.get(date)
        if (list) list.push(event)
        else map.set(date, [event])
      }
    }
    // All-day entries first, then by time — the order somebody reads a day in.
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
        return a.start.localeCompare(b.start)
      })
    }
    return map
  }, [events, hidden, from, to])

  function step(direction: 1 | -1) {
    if (mode === 'week') {
      onNavigate(addDaysIso(anchor, 7 * direction))
      return
    }
    const nextMonth = anchorMonth - 1 + direction
    const date = new Date(Date.UTC(anchorYear, nextMonth, 1))
    onNavigate(iso(date.getUTCFullYear(), date.getUTCMonth(), 1))
  }

  function toggleKind(kind: CalendarEventKind) {
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })
  }

  /** Only offer a filter for a kind that actually appears in this period. */
  const present = React.useMemo(() => {
    const kinds = new Set<CalendarEventKind>()
    for (const event of events) kinds.add(event.kind)
    return Array.from(kinds)
  }, [events])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="secondary" aria-label="Previous" onClick={() => step(-1)}>
            <ChevronLeft />
          </Button>
          <Button size="icon" variant="secondary" aria-label="Next" onClick={() => step(1)}>
            <ChevronRight />
          </Button>
          <Button variant="ghost" onClick={() => onNavigate(today)}>
            Today
          </Button>
          <p className="ml-1 text-[15px] font-semibold tracking-[-0.01em]">{title}</p>
        </div>

        <div className="inline-flex rounded-lg border border-line p-0.5">
          {(['month', 'week'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onModeChange(option)}
              className={cn(
                'focus-ring rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition',
                mode === option ? 'bg-brand-600 text-white' : 'text-ink-muted hover:text-ink'
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {present.length ? (
        <div className="flex flex-wrap gap-1.5">
          {present.map((kind) => {
            const style = EVENT_STYLES[kind]
            const off = hidden.has(kind)
            return (
              <button
                key={kind}
                type="button"
                onClick={() => toggleKind(kind)}
                aria-pressed={!off}
                className={cn(
                  'focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                  off
                    ? 'border-line text-ink-muted/60 line-through'
                    : 'border-transparent ' + style.chip
                )}
              >
                <span className={cn('size-2 rounded-full', off ? 'bg-ink-muted/40' : style.dot)} />
                {style.label}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-line bg-card shadow-sm">
        <div className="grid grid-cols-7 border-b border-line bg-page">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
            >
              {day}
            </div>
          ))}
        </div>

        <div className={cn('grid grid-cols-7', mode === 'month' ? 'grid-rows-6' : 'grid-rows-1')}>
          {cells.map((cell) => {
            const dayEvents = byDate.get(cell.date) ?? []
            const isToday = cell.date === today

            return (
              <div
                key={cell.date}
                className={cn(
                  'border-b border-r border-line p-1.5 last:border-r-0',
                  mode === 'month' ? 'min-h-[7rem]' : 'min-h-[18rem]',
                  cell.muted && 'bg-page/60'
                )}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={cn(
                      'tabular inline-flex size-6 items-center justify-center rounded-full text-xs',
                      isToday
                        ? 'bg-brand-600 font-semibold text-white'
                        : cell.muted
                          ? 'text-ink-muted/50'
                          : 'text-ink-muted'
                    )}
                  >
                    {Number(cell.date.slice(8))}
                  </span>
                </div>

                <ul className="space-y-1">
                  {dayEvents.slice(0, mode === 'month' ? 3 : 20).map((event) => (
                    <li key={`${event.id}-${cell.date}`}>
                      <EventChip event={event} timezone={timezone} />
                    </li>
                  ))}
                  {mode === 'month' && dayEvents.length > 3 ? (
                    <li className="px-1 text-[11px] text-ink-muted">
                      +{dayEvents.length - 3} more
                    </li>
                  ) : null}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function EventChip({ event, timezone }: { event: CalendarEvent; timezone: string }) {
  const style = EVENT_STYLES[event.kind]

  const time = event.allDay
    ? null
    : new Date(event.start).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: timezone,
      })

  const body = (
    <span
      className={cn(
        'block truncate rounded px-1.5 py-0.5 text-[11px] leading-tight',
        style.chip
      )}
      title={`${time ? `${time} ` : ''}${event.title}`}
    >
      {time ? <span className="tabular mr-1 opacity-70">{time}</span> : null}
      {event.title}
    </span>
  )

  return event.href ? (
    <Link href={event.href} className="focus-ring block rounded">
      {body}
    </Link>
  ) : (
    body
  )
}

function monthLabel(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
