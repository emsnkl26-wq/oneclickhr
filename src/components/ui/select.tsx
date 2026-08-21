'use client'

/**
 * The app's dropdown.
 *
 * A native `<select>` cannot be styled — its popup is drawn by the operating
 * system, so it lands in the middle of our own surfaces looking like a visitor
 * from another application. This is a listbox we draw ourselves: same rounded
 * field, same border, same brand accent, same behaviour in dark mode.
 *
 * The API is deliberately the NATIVE one — `value`, `onChange` carrying
 * `event.target.value`, and `<option>` children — so every existing call site
 * keeps working untouched and no form logic had to move. The children are read
 * as data rather than rendered; `<optgroup>` is understood too.
 *
 * Positioning comes from Radix Popover (portal, collision flipping, trigger
 * width). Everything the user sees and touches is ours.
 */

import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Check, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWheelScroll } from '@/components/ui/use-wheel-scroll'

/** Shaped like a native change event so `(e) => e.target.value` still reads. */
export type SelectChangeEvent = { target: { value: string; name: string } }

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** The `<optgroup>` this option came from, if any. */
  group?: string
}

export interface SelectProps {
  value?: string
  defaultValue?: string
  onChange?: (event: SelectChangeEvent) => void
  name?: string
  id?: string
  disabled?: boolean
  required?: boolean
  className?: string
  /** Shown when nothing is selected and no option carries the empty value. */
  placeholder?: string
  /** Force the filter box on or off. Default: on once the list gets long. */
  searchable?: boolean
  children?: React.ReactNode
  /** Provide options directly instead of as `<option>` children. */
  options?: SelectOption[]
  'aria-label'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
}

/** Flatten an option's children to a plain string label. */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) {
    return textOf((node.props as { children?: React.ReactNode }).children)
  }
  return ''
}

/** Walk the children tree and read `<option>` / `<optgroup>` as plain data. */
function readOptions(children: React.ReactNode, group?: string): SelectOption[] {
  const out: SelectOption[] = []

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return

    if (child.type === 'optgroup') {
      const props = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>
      out.push(...readOptions(props.children, props.label ?? undefined))
      return
    }

    if (child.type === 'option') {
      const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement> & {
        children?: React.ReactNode
      }
      out.push({
        value: String(props.value ?? ''),
        label: textOf(props.children) || String(props.value ?? ''),
        disabled: props.disabled,
        group,
      })
      return
    }

    // Fragments and other wrappers: keep looking inside them.
    const nested = (child.props as { children?: React.ReactNode })?.children
    if (nested) out.push(...readOptions(nested, group))
  })

  return out
}

/** The field shell every control in the app shares. */
export const controlBase =
  'w-full rounded-lg border border-line bg-card px-3 text-sm text-ink shadow-sm transition-colors ' +
  'placeholder:text-ink-muted/70 focus-ring disabled:cursor-not-allowed disabled:bg-page ' +
  'disabled:text-ink-muted aria-[invalid=true]:border-danger'

/** Once the list gets past this, a filter box earns its place. */
const SEARCH_THRESHOLD = 8

export const Select = React.forwardRef<HTMLButtonElement, SelectProps>(function Select(
  {
    value,
    defaultValue,
    onChange,
    name = '',
    id,
    disabled,
    required,
    className,
    placeholder = 'Select…',
    searchable,
    children,
    options: optionsProp,
    ...aria
  },
  ref
) {
  const options = React.useMemo(
    () => optionsProp ?? readOptions(children),
    [optionsProp, children]
  )

  // Uncontrolled use is supported so this can stand in anywhere a native
  // `<select>` could.
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue ?? '')
  const current = value !== undefined ? value : uncontrolled

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)
  // Inside a dialog the page scroll lock cancels wheel events over this
  // portalled list, so it scrolls itself.
  useWheelScroll(listRef, open)
  const reactId = React.useId()
  const listboxId = `${id ?? reactId}-listbox`

  const showSearch = searchable ?? options.length > SEARCH_THRESHOLD

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((option) => option.label.toLowerCase().includes(q))
  }, [options, query])

  const selected = options.find((option) => option.value === current)

  function commit(next: string) {
    if (value === undefined) setUncontrolled(next)
    onChange?.({ target: { value: next, name } })
    setOpen(false)
  }

  // Opening lands the highlight on what is already chosen, so Enter is a no-op
  // rather than a surprise.
  React.useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const index = matches.findIndex((option) => option.value === current)
    setActiveIndex(index >= 0 ? index : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Filtering invalidates the old highlight position.
  React.useEffect(() => {
    setActiveIndex(0)
  }, [query])

  React.useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, matches.length])

  function step(delta: number) {
    if (!matches.length) return
    let next = activeIndex
    for (let i = 0; i < matches.length; i += 1) {
      next = (next + delta + matches.length) % matches.length
      if (!matches[next]?.disabled) break
    }
    setActiveIndex(next)
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        step(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        step(-1)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(matches.length - 1)
        break
      case 'Enter': {
        event.preventDefault()
        const option = matches[activeIndex]
        if (option && !option.disabled) commit(option.value)
        break
      }
      case 'Tab':
        setOpen(false)
        break
      default:
        break
    }
  }

  let lastGroup: string | undefined

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={disabled ? undefined : setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          ref={ref}
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-required={required || undefined}
          disabled={disabled}
          onKeyDown={onKeyDown}
          className={cn(
            controlBase,
            'flex h-10 items-center justify-between gap-2 text-left',
            'hover:border-ink-muted/40 data-[state=open]:border-brand-600 data-[state=open]:ring-2 data-[state=open]:ring-brand-600/15',
            className
          )}
          {...aria}
        >
          <span className={cn('min-w-0 flex-1 truncate', !selected?.label && 'text-ink-muted/70')}>
            {selected?.label || placeholder}
          </span>
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-ink-muted transition-transform duration-200',
              open && 'rotate-180'
            )}
            aria-hidden
          />
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(event) => {
            // Keep focus on the trigger unless there is a filter box to type in;
            // arrow keys then drive the list from where the user already is.
            if (!showSearch) event.preventDefault()
          }}
          className={cn(
            'z-50 w-[var(--radix-popover-trigger-width)] min-w-[10rem] overflow-hidden rounded-xl border border-line bg-card p-1 shadow-pop',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'
          )}
        >
          {showSearch ? (
            <div className="relative mb-1 border-b border-line px-1 pb-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-muted"
                aria-hidden
              />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search…"
                aria-label="Filter options"
                className="h-8 w-full rounded-lg bg-transparent pl-8 pr-2 text-sm text-ink outline-none placeholder:text-ink-muted/70"
              />
            </div>
          ) : null}

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            className="scrollbar-thin max-h-[min(16rem,var(--radix-popover-content-available-height,16rem))] overflow-y-auto overscroll-contain"
          >
            {matches.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-ink-muted">No matches</p>
            ) : (
              matches.map((option, index) => {
                const isSelected = option.value === current
                const isActive = index === activeIndex
                const groupHeader = option.group && option.group !== lastGroup ? option.group : null
                lastGroup = option.group

                return (
                  <React.Fragment key={`${option.group ?? ''}:${option.value}`}>
                    {groupHeader ? (
                      <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                        {groupHeader}
                      </p>
                    ) : null}
                    <div
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      data-active={isActive}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => {
                        if (!option.disabled) commit(option.value)
                      }}
                      className={cn(
                        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors',
                        isActive && 'bg-page',
                        isSelected ? 'font-medium text-brand-600' : 'text-ink',
                        option.disabled && 'pointer-events-none opacity-50'
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {isSelected ? <Check className="size-4 shrink-0" aria-hidden /> : null}
                    </div>
                  </React.Fragment>
                )
              })
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
})
