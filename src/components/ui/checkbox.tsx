'use client'

/**
 * Checkbox and radio, drawn rather than borrowed.
 *
 * A native checkbox is painted by the OS: it ignores our brand colour, keeps a
 * square-ish system look in dark mode, and sizes itself differently on every
 * platform. These render their own box and hide a real input underneath, so the
 * control stays keyboard-focusable, form-associated and announced correctly —
 * only the pixels are ours.
 *
 * The API matches the native one (`checked`, `onChange` with
 * `event.target.checked`), so existing handlers move across unchanged.
 */

import * as React from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  /** Renders the dash state for "some but not all of the children". */
  indeterminate?: boolean
  /** Optional inline label; omit it when the checkbox sits inside its own label. */
  label?: React.ReactNode
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { className, indeterminate, label, disabled, ...props },
  ref
) {
  const inner = React.useRef<HTMLInputElement>(null)
  React.useImperativeHandle(ref, () => inner.current as HTMLInputElement)

  // `indeterminate` is a DOM property with no HTML attribute behind it.
  React.useEffect(() => {
    if (inner.current) inner.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])

  const box = (
    <span className="relative inline-grid size-[18px] shrink-0 place-items-center">
      <input
        ref={inner}
        type="checkbox"
        disabled={disabled}
        className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-[6px] border border-line bg-card transition-colors checked:border-brand-600 checked:bg-brand-600 indeterminate:border-brand-600 indeterminate:bg-brand-600 hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/70 focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-not-allowed disabled:bg-page disabled:opacity-60"
        {...props}
      />
      {indeterminate ? (
        <Minus className="pointer-events-none relative size-3 stroke-[3] text-white" aria-hidden />
      ) : (
        <Check
          className="pointer-events-none relative size-3 stroke-[3] text-white opacity-0 transition-opacity peer-checked:opacity-100"
          aria-hidden
        />
      )}
    </span>
  )

  if (!label) return <span className={cn('inline-flex', className)}>{box}</span>

  return (
    <label
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 text-sm text-ink',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    >
      {box}
      <span className="min-w-0">{label}</span>
    </label>
  )
})

/* -------------------------------------------------------------------- Radio */

export interface RadioProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: React.ReactNode
}

export const Radio = React.forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { className, label, disabled, ...props },
  ref
) {
  const dot = (
    <span className="relative inline-grid size-[18px] shrink-0 place-items-center">
      <input
        ref={ref}
        type="radio"
        disabled={disabled}
        className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-full border border-line bg-card transition-colors checked:border-[5px] checked:border-brand-600 hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/70 focus-visible:ring-offset-2 focus-visible:ring-offset-page disabled:cursor-not-allowed disabled:bg-page disabled:opacity-60"
        {...props}
      />
    </span>
  )

  if (!label) return <span className={cn('inline-flex', className)}>{dot}</span>

  return (
    <label
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 text-sm text-ink',
        disabled && 'cursor-not-allowed opacity-60',
        className
      )}
    >
      {dot}
      <span className="min-w-0">{label}</span>
    </label>
  )
})

/* --------------------------------------------------------------- RadioCards */

export interface RadioCardOption {
  value: string
  label: string
  description?: string
  icon?: React.ReactNode
  disabled?: boolean
}

/**
 * The segmented alternative to a dropdown, for two or three mutually exclusive
 * choices that deserve to be visible rather than hidden behind a popover.
 */
export function RadioCards({
  value,
  onChange,
  options,
  name,
  className,
  columns = 2,
}: {
  value: string
  onChange: (value: string) => void
  options: RadioCardOption[]
  name?: string
  className?: string
  columns?: 1 | 2 | 3
}) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'grid gap-2',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-3',
        className
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            data-name={name}
            onClick={() => onChange(option.value)}
            className={cn(
              'focus-ring flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors',
              selected
                ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600/20'
                : 'border-line bg-card hover:border-ink-muted/40 hover:bg-page',
              option.disabled && 'pointer-events-none opacity-50'
            )}
          >
            {option.icon ? (
              <span className={cn('mt-0.5 shrink-0', selected ? 'text-brand-600' : 'text-ink-muted')}>
                {option.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block truncate text-sm font-medium',
                  selected ? 'text-brand-700' : 'text-ink'
                )}
              >
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                  {option.description}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                'mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border transition-colors',
                selected ? 'border-[5px] border-brand-600' : 'border-line'
              )}
              aria-hidden
            />
          </button>
        )
      })}
    </div>
  )
}
