'use client'

import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

let idCounter = 0

/**
 * Label + control + help text + error, wired together for accessibility.
 *
 * The error is bound with `aria-describedby` and `aria-invalid` on the control
 * itself (cloned in), so a screen reader announces the problem when focus lands
 * on the field rather than leaving it as visual-only red text.
 */
export interface FormFieldProps {
  /** Usually a string; a node when the label carries a badge (e.g. "Admin only"). */
  label: React.ReactNode
  htmlFor?: string
  error?: string | null
  hint?: string
  required?: boolean
  className?: string
  children: React.ReactNode
}

export function FormField({
  label, htmlFor, error, hint, required, className, children,
}: FormFieldProps) {
  const reactId = React.useId()
  const id = htmlFor || `field-${reactId}`
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
      })
    : children

  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  )
}

/** A whole-form error banner, for failures that belong to no single field. */
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-lg border border-brand-200 bg-brand-50 px-3.5 py-3 text-sm text-brand-ink"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

/** The positive twin, for confirmations that stay on the page. */
export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <div
      role="status"
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800"
    >
      {message}
    </div>
  )
}

/** Stable ids for uncontrolled forms that need to reference a field by name. */
export function useFieldId(prefix = 'field'): string {
  const [id] = React.useState(() => `${prefix}-${++idCounter}`)
  return id
}
