'use client'

/**
 * Date, time and date-time pickers drawn by us.
 *
 * `<input type="date">` is a different control in every browser — Chrome draws
 * one calendar, Safari another, Firefox a bare text box with a spinner. None of
 * them can be themed, so the one field on a form that the user has to think
 * hardest about was also the one that looked least like the rest of the app.
 *
 * These keep the NATIVE contract on purpose — `value` / `onChange` with
 * `event.target.value`, plus `min` and `max` — and the same wire formats the
 * native inputs use:
 *
 *   DateField      YYYY-MM-DD
 *   TimeField      HH:mm          (24-hour, as `type="time"` submits)
 *   DateTimeField  YYYY-MM-DDTHH:mm
 *
 * So every call site and every request body is byte-for-byte what it was; only
 * the pixels changed.
 */

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select, controlBase } from '@/components/ui/select'
import { useWheelScroll } from '@/components/ui/use-wheel-scroll'

/** The month/year jump menus sit flush in the header, so they lose the chrome. */
const jumpTrigger =
  'h-8 w-auto flex-none gap-1 border-transparent bg-transparent px-2 font-semibold shadow-none hover:bg-page'

/* ------------------------------------------------------------ Date helpers */

/*
 * Everything here works on `YYYY-MM-DD` strings and LOCAL calendar dates.
 * `new Date('2026-08-21')` parses as UTC midnight, which is the previous day
 * for anyone west of Greenwich — the classic off-by-one in date pickers. Parsing
 * the parts by hand avoids it entirely.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local `Date` -> `YYYY-MM-DD`. */
function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `YYYY-MM-DD` -> local `Date` at midnight, or null if it is not a date. */
function fromISODate(value: string | undefined | null): Date | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

/** "21 Aug 2026" — unambiguous in every locale, unlike 08/21 vs 21/08. */
function formatISODate(value: string): string {
  const date = fromISODate(value)
  if (!date) return ''
  return `${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`
}

/** "09:30" -> "9:30 AM". Empty in, empty out. */
function formatTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '')
  if (!match) return ''
  const hours = Number(match[1])
  const meridiem = hours >= 12 ? 'PM' : 'AM'
  const display = hours % 12 === 0 ? 12 : hours % 12
  return `${display}:${match[2]} ${meridiem}`
}

/** The 42 cells of a month grid: leading and trailing days included. */
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}

/* ------------------------------------------------------------- The calendar */

export interface CalendarProps {
  /** `YYYY-MM-DD`, or '' for nothing selected. */
  value: string
  onSelect: (value: string) => void
  min?: string
  max?: string
}

/**
 * Standalone month grid. Exported so a page can inline a calendar rather than
 * hang one off a field.
 */
export function Calendar({ value, onSelect, min, max }: CalendarProps) {
  const selected = fromISODate(value)
  const today = React.useMemo(() => new Date(), [])
  const todayISO = toISODate(today)

  const [cursor, setCursor] = React.useState(() => {
    const base = selected ?? today
    return { year: base.getFullYear(), month: base.getMonth() }
  })

  // Following the value keeps the grid on the right month when a form loads a
  // record, or when a sibling field pushes this one forward (leave "to" dates).
  React.useEffect(() => {
    if (!selected) return
    setCursor({ year: selected.getFullYear(), month: selected.getMonth() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const days = React.useMemo(() => monthGrid(cursor.year, cursor.month), [cursor])

  function shiftMonth(delta: number) {
    setCursor((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1)
      return { year: next.getFullYear(), month: next.getMonth() }
    })
  }

  // ISO dates sort lexicographically, so the bounds need no parsing.
  function outOfRange(iso: string): boolean {
    if (min && iso < min) return true
    if (max && iso > max) return true
    return false
  }

  const years = React.useMemo(() => {
    const base = today.getFullYear()
    return Array.from({ length: 121 }, (_, i) => base - 100 + i)
  }, [today])

  return (
    <div className="w-[17.5rem] p-3">
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
          className="focus-ring grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-page hover:text-ink"
        >
          <ChevronLeft className="size-4" />
        </button>

        {/* Our own dropdowns rather than two bare `<select>`s — a native popup
            opening on top of a custom calendar is exactly the seam this whole
            component set exists to remove. */}
        <div className="flex flex-1 items-center justify-center gap-1">
          <Select
            value={String(cursor.month)}
            onChange={(event) => setCursor((p) => ({ ...p, month: Number(event.target.value) }))}
            aria-label="Month"
            searchable={false}
            options={MONTHS.map((name, index) => ({ value: String(index), label: name }))}
            className={jumpTrigger}
          />
          <Select
            value={String(cursor.year)}
            onChange={(event) => setCursor((p) => ({ ...p, year: Number(event.target.value) }))}
            aria-label="Year"
            options={years.map((year) => ({ value: String(year), label: String(year) }))}
            className={cn(jumpTrigger, 'tabular w-[5.25rem]')}
          />
        </div>

        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
          className="focus-ring grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-page hover:text-ink"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5" role="grid">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="grid h-8 place-items-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
          >
            {day}
          </div>
        ))}

        {days.map((day) => {
          const iso = toISODate(day)
          const isCurrentMonth = day.getMonth() === cursor.month
          const isSelected = iso === value
          const isToday = iso === todayISO
          const disabled = outOfRange(iso)

          return (
            <button
              key={iso}
              type="button"
              disabled={disabled}
              aria-current={isToday ? 'date' : undefined}
              aria-selected={isSelected}
              onClick={() => onSelect(iso)}
              className={cn(
                'tabular focus-ring relative grid h-9 place-items-center rounded-lg text-[13px] transition-colors',
                isSelected
                  ? 'bg-brand-600 font-semibold text-white shadow-sm'
                  : isCurrentMonth
                    ? 'text-ink hover:bg-page'
                    : 'text-ink-muted/45 hover:bg-page',
                disabled && 'pointer-events-none opacity-30'
              )}
            >
              {day.getDate()}
              {isToday && !isSelected ? (
                <span className="absolute bottom-1 size-1 rounded-full bg-brand-600" aria-hidden />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- The time board */

const MINUTE_STEP = 5

const timeColumn =
  'scrollbar-thin flex max-h-52 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1'

/**
 * One scrolling column of the time board. Top-level rather than nested in
 * `TimeBoard` so it keeps its DOM node — and therefore its scroll position —
 * when picking an hour re-renders the board.
 */
function TimeColumn({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)
  useWheelScroll(ref)
  return (
    <div ref={ref} className={timeColumn}>
      {children}
    </div>
  )
}

function TimeBoard({ value, onSelect }: { value: string; onSelect: (value: string) => void }) {
  const match = /^(\d{1,2}):(\d{2})/.exec(value ?? '')
  const hours24 = match ? Number(match[1]) : null
  const minutes = match ? Number(match[2]) : null
  const meridiem = hours24 === null ? 'AM' : hours24 >= 12 ? 'PM' : 'AM'
  const hour12 = hours24 === null ? null : hours24 % 12 === 0 ? 12 : hours24 % 12

  // Both columns scroll, so the current hour/minute is often below the fold when
  // the board opens. Bring it into view once, without scrolling the page.
  const hourRef = React.useRef<HTMLButtonElement>(null)
  const minuteRef = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => {
    for (const node of [hourRef.current, minuteRef.current]) {
      if (!node) continue
      const list = node.parentElement
      if (!list) continue
      list.scrollTop = node.offsetTop - list.clientHeight / 2 + node.clientHeight / 2
    }
    // Only on open — later clicks should not yank the list under the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function commit(nextHour12: number, nextMinute: number, nextMeridiem: 'AM' | 'PM') {
    const h = (nextHour12 % 12) + (nextMeridiem === 'PM' ? 12 : 0)
    onSelect(`${pad(h)}:${pad(nextMinute)}`)
  }

  const cell =
    'tabular focus-ring shrink-0 rounded-lg px-3 py-1.5 text-[13px] transition-colors hover:bg-page'

  return (
    <div className="flex divide-x divide-line p-2" role="group" aria-label="Time">
      <TimeColumn>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <button
            key={h}
            ref={h === hour12 ? hourRef : undefined}
            type="button"
            onClick={() => commit(h, minutes ?? 0, meridiem)}
            className={cn(cell, h === hour12 && 'bg-brand-600 font-semibold text-white hover:bg-brand-700')}
          >
            {pad(h)}
          </button>
        ))}
      </TimeColumn>
      <TimeColumn>
        {Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP).map((m) => (
          <button
            key={m}
            ref={m === minutes ? minuteRef : undefined}
            type="button"
            onClick={() => commit(hour12 ?? 9, m, meridiem)}
            className={cn(cell, m === minutes && 'bg-brand-600 font-semibold text-white hover:bg-brand-700')}
          >
            {pad(m)}
          </button>
        ))}
      </TimeColumn>
      <div className="flex flex-col gap-0.5 px-1">
        {(['AM', 'PM'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => commit(hour12 ?? 9, minutes ?? 0, m)}
            className={cn(
              cell,
              hours24 !== null && m === meridiem && 'bg-brand-600 font-semibold text-white hover:bg-brand-700'
            )}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- Shared trigger */

type FieldChangeEvent = { target: { value: string; name: string } }

interface TriggerProps {
  display: string
  placeholder: string
  icon: React.ReactNode
  open: boolean
  disabled?: boolean
  required?: boolean
  className?: string
  id?: string
  aria: Record<string, unknown>
}

const PickerTrigger = React.forwardRef<HTMLButtonElement, TriggerProps>(function PickerTrigger(
  { display, placeholder, icon, open, disabled, required, className, id, aria, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      id={id}
      disabled={disabled}
      aria-required={required || undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cn(
        controlBase,
        'flex h-10 items-center justify-between gap-2 text-left',
        'hover:border-ink-muted/40 data-[state=open]:border-brand-600 data-[state=open]:ring-2 data-[state=open]:ring-brand-600/15',
        className
      )}
      {...aria}
      {...rest}
    >
      <span className={cn('min-w-0 flex-1 truncate', !display && 'text-ink-muted/70')}>
        {display || placeholder}
      </span>
      <span className="shrink-0 text-ink-muted" aria-hidden>
        {icon}
      </span>
    </button>
  )
})

function PickerPopover({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactNode
  children: React.ReactNode
}) {
  // The shell scrolls too when the popover is taller than the room on screen,
  // so it needs the same wheel handling as the columns inside it.
  const contentRef = React.useRef<HTMLDivElement>(null)
  useWheelScroll(contentRef, open)

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={contentRef}
          align="start"
          sideOffset={6}
          collisionPadding={12}
          // Radix measures the room left on screen for us; without this the
          // popover simply ran off the bottom of a small window and the parts
          // below the fold were unreachable.
          style={{ maxHeight: 'var(--radix-popover-content-available-height)' }}
          className={cn(
            'scrollbar-thin z-50 flex flex-col overflow-y-auto overscroll-contain rounded-xl border border-line bg-card shadow-pop',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'
          )}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** The row of shortcuts under a picker. Clear only appears when it may be used. */
function PickerFooter({
  onToday,
  onClear,
  todayLabel,
}: {
  onToday: () => void
  onClear?: () => void
  todayLabel: string
}) {
  return (
    <div className="sticky bottom-0 flex shrink-0 items-center justify-between gap-2 border-t border-line bg-card px-3 py-2">
      <button
        type="button"
        onClick={onToday}
        className="focus-ring rounded-lg px-2 py-1 text-[13px] font-medium text-brand-600 transition-colors hover:bg-brand-50"
      >
        {todayLabel}
      </button>
      {onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="focus-ring rounded-lg px-2 py-1 text-[13px] text-ink-muted transition-colors hover:bg-page hover:text-ink"
        >
          Clear
        </button>
      ) : null}
    </div>
  )
}

/* -------------------------------------------------------------- DateField */

export interface DateFieldProps {
  value?: string
  onChange?: (event: FieldChangeEvent) => void
  min?: string
  max?: string
  name?: string
  id?: string
  disabled?: boolean
  required?: boolean
  className?: string
  placeholder?: string
  'aria-label'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
}

export const DateField = React.forwardRef<HTMLButtonElement, DateFieldProps>(function DateField(
  { value = '', onChange, min, max, name = '', id, disabled, required, className, placeholder = 'Pick a date', ...aria },
  ref
) {
  const [open, setOpen] = React.useState(false)

  function emit(next: string) {
    onChange?.({ target: { value: next, name } })
  }

  return (
    <PickerPopover
      open={open}
      onOpenChange={disabled ? () => {} : setOpen}
      trigger={
        <PickerTrigger
          ref={ref}
          id={id}
          open={open}
          disabled={disabled}
          required={required}
          className={className}
          display={formatISODate(value)}
          placeholder={placeholder}
          icon={<CalendarDays className="size-4" />}
          aria={aria}
        />
      }
    >
      <Calendar
        value={value}
        min={min}
        max={max}
        onSelect={(next) => {
          emit(next)
          setOpen(false)
        }}
      />
      <PickerFooter
        todayLabel="Today"
        onToday={() => {
          emit(toISODate(new Date()))
          setOpen(false)
        }}
        onClear={
          required || !value
            ? undefined
            : () => {
                emit('')
                setOpen(false)
              }
        }
      />
    </PickerPopover>
  )
})

/* -------------------------------------------------------------- TimeField */

export type TimeFieldProps = Omit<DateFieldProps, 'min' | 'max'>

export const TimeField = React.forwardRef<HTMLButtonElement, TimeFieldProps>(function TimeField(
  { value = '', onChange, name = '', id, disabled, required, className, placeholder = 'Pick a time', ...aria },
  ref
) {
  const [open, setOpen] = React.useState(false)

  function emit(next: string) {
    onChange?.({ target: { value: next, name } })
  }

  return (
    <PickerPopover
      open={open}
      onOpenChange={disabled ? () => {} : setOpen}
      trigger={
        <PickerTrigger
          ref={ref}
          id={id}
          open={open}
          disabled={disabled}
          required={required}
          className={className}
          display={formatTime(value)}
          placeholder={placeholder}
          icon={<Clock className="size-4" />}
          aria={aria}
        />
      }
    >
      <TimeBoard value={value} onSelect={emit} />
      <PickerFooter
        todayLabel="Now"
        onToday={() => {
          const now = new Date()
          emit(`${pad(now.getHours())}:${pad(now.getMinutes())}`)
          setOpen(false)
        }}
        onClear={
          required || !value
            ? undefined
            : () => {
                emit('')
                setOpen(false)
              }
        }
      />
    </PickerPopover>
  )
})

/* ---------------------------------------------------------- DateTimeField */

/**
 * Calendar and clock in one popover, emitting the `YYYY-MM-DDTHH:mm` that
 * `datetime-local` submits — meetings depend on that exact shape.
 */
export const DateTimeField = React.forwardRef<HTMLButtonElement, DateFieldProps>(
  function DateTimeField(
    { value = '', onChange, min, max, name = '', id, disabled, required, className, placeholder = 'Pick a date and time', ...aria },
    ref
  ) {
    const [open, setOpen] = React.useState(false)
    const [datePart = '', timePart = ''] = value ? value.split('T') : []

    function emit(nextDate: string, nextTime: string) {
      // A half-filled value would be rejected by the server, so hold it back
      // until both halves exist. Picking a date defaults the clock to 09:00.
      if (!nextDate) {
        onChange?.({ target: { value: '', name } })
        return
      }
      onChange?.({ target: { value: `${nextDate}T${nextTime || '09:00'}`, name } })
    }

    const display = datePart
      ? `${formatISODate(datePart)}${timePart ? ` · ${formatTime(timePart)}` : ''}`
      : ''

    return (
      <PickerPopover
        open={open}
        onOpenChange={disabled ? () => {} : setOpen}
        trigger={
          <PickerTrigger
            ref={ref}
            id={id}
            open={open}
            disabled={disabled}
            required={required}
            className={className}
            display={display}
            placeholder={placeholder}
            icon={<CalendarDays className="size-4" />}
            aria={aria}
          />
        }
      >
        <div className="flex flex-col sm:flex-row sm:divide-x sm:divide-line">
          <Calendar
            value={datePart}
            min={min?.split('T')[0]}
            max={max?.split('T')[0]}
            onSelect={(next) => emit(next, timePart)}
          />
          <div className="border-t border-line sm:border-t-0">
            <TimeBoard value={timePart} onSelect={(next) => emit(datePart || toISODate(new Date()), next)} />
          </div>
        </div>
        <PickerFooter
          todayLabel="Now"
          onToday={() => {
            const now = new Date()
            emit(toISODate(now), `${pad(now.getHours())}:${pad(now.getMinutes())}`)
            setOpen(false)
          }}
          onClear={
            required || !value
              ? undefined
              : () => {
                  emit('', '')
                  setOpen(false)
                }
          }
        />
      </PickerPopover>
    )
  }
)

export { toISODate, fromISODate, formatISODate, formatTime }
