import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The one field recipe: 1px line, soft radius, brand ring on focus.
 *
 * `Select`, `DateField`, `TimeField` and `DateTimeField` re-use this exact shell
 * so a form reads as one row of controls rather than a mix of ours and the
 * browser's. They are re-exported from here because that is where every call
 * site already imports its fields from.
 */
const fieldBase =
  'w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink shadow-sm transition-colors ' +
  'placeholder:text-ink-muted/70 hover:border-ink-muted/40 focus-ring ' +
  'focus-visible:border-brand-600 disabled:cursor-not-allowed disabled:bg-page ' +
  'disabled:text-ink-muted aria-[invalid=true]:border-danger'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(fieldBase, 'h-10', className)} {...props} />
  )
)
Input.displayName = 'Input'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(fieldBase, 'scrollbar-thin resize-y leading-relaxed', className)}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Input, Textarea, fieldBase }

/*
 * Re-exports, so `import { Input, Select } from '@/components/ui/input'` keeps
 * working everywhere it already did.
 */
export { Select, type SelectProps, type SelectOption, type SelectChangeEvent } from '@/components/ui/select'
export {
  DateField, TimeField, DateTimeField, Calendar,
  type DateFieldProps, type TimeFieldProps,
} from '@/components/ui/date-picker'
export { Checkbox, Radio, RadioCards } from '@/components/ui/checkbox'
