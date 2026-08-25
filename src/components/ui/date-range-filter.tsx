'use client'

/**
 * A from/to pair bound to the URL.
 *
 * Companion to `SearchField` and `FilterSelect`, and the same reasoning: the
 * range is part of the query the SERVER runs, so it belongs in the address bar
 * rather than in component state that only means something once every row is
 * already in the browser. It also makes a filtered view shareable — "here is the
 * quarter I am asking about" is a link, not a set of instructions.
 *
 * Changing either end resets the page, because landing on page 7 of a
 * three-page result is the classic bug this avoids.
 */

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { DateField } from '@/components/ui/date-picker'
import { Button } from '@/components/ui/button'
import { useProgressRouter } from '@/lib/use-progress-router'
import { cn } from '@/lib/utils'

export function DateRangeFilter({
  fromParam = 'from',
  toParam = 'to',
  resets = ['page'],
  className,
}: {
  fromParam?: string
  toParam?: string
  resets?: string[]
  className?: string
}) {
  const router = useProgressRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const from = searchParams.get(fromParam) ?? ''
  const to = searchParams.get(toParam) ?? ''

  function commit(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    for (const key of resets) params.delete(key)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <DateField
        value={from}
        max={to || undefined}
        placeholder="From"
        aria-label="From date"
        onChange={(event) => commit({ [fromParam]: event.target.value })}
        className="sm:w-40"
      />
      <span className="text-sm text-ink-muted" aria-hidden>
        –
      </span>
      <DateField
        value={to}
        min={from || undefined}
        placeholder="To"
        aria-label="To date"
        onChange={(event) => commit({ [toParam]: event.target.value })}
        className="sm:w-40"
      />
      {from || to ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Clear the date range"
          onClick={() => commit({ [fromParam]: '', [toParam]: '' })}
        >
          <X />
        </Button>
      ) : null}
    </div>
  )
}
