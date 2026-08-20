'use client'

/**
 * A search box whose value lives in the URL.
 *
 * Client-side filtering only works while the whole dataset is already in the
 * browser, and "send every row so the browser can filter it" is precisely the
 * cost that does not survive a customer with real data in it. Putting the term
 * in the URL lets the server filter — against an index — and return a page.
 *
 * The debounce is what makes that affordable: one request per pause in typing,
 * not one per keystroke. `replace` rather than `push` keeps a search from
 * burying the previous page under twenty history entries.
 */

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { useProgressRouter } from '@/lib/use-progress-router'
import { cn } from '@/lib/utils'

const DEBOUNCE_MS = 350

export function SearchField({
  param = 'q',
  placeholder = 'Search',
  label = 'Search',
  /** Params to clear when the term changes — a new search starts at page 1. */
  resets = ['page'],
  className,
}: {
  param?: string
  placeholder?: string
  label?: string
  resets?: string[]
  className?: string
}) {
  const router = useProgressRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const urlValue = searchParams.get(param) ?? ''
  const [value, setValue] = React.useState(urlValue)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Adopt the URL's value when it changes underneath us — a back button, or a
  // link that sets the term — but never while an edit is still settling, or the
  // box would fight the person typing in it.
  React.useEffect(() => {
    if (timer.current) return
    setValue(urlValue)
  }, [urlValue])

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function commit(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next.trim()) params.set(param, next.trim())
    else params.delete(param)
    for (const key of resets) params.delete(key)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function onChange(next: string) {
    setValue(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      commit(next)
    }, DEBOUNCE_MS)
  }

  return (
    <div className={cn('relative flex-1', className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          if (timer.current) clearTimeout(timer.current)
          timer.current = null
          commit(value)
        }}
        placeholder={placeholder}
        className="pl-9"
        aria-label={label}
        type="search"
      />
    </div>
  )
}
