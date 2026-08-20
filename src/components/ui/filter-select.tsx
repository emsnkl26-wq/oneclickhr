'use client'

/**
 * A `<select>` bound to a URL parameter.
 *
 * Companion to `SearchField`: same reasoning, same contract. The filter is part
 * of the query the server runs, so it belongs in the address bar rather than in
 * component state that only means something once every row is already loaded.
 *
 * Changing a filter resets the page — landing on page 7 of a three-page result
 * is the classic bug this avoids.
 */

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Select } from '@/components/ui/input'
import { useProgressRouter } from '@/lib/use-progress-router'

export interface FilterOption {
  /** '' clears the parameter — use it for the "All" entry. */
  value: string
  label: string
}

export function FilterSelect({
  param,
  options,
  label,
  resets = ['page'],
  className,
}: {
  param: string
  options: FilterOption[]
  label: string
  resets?: string[]
  className?: string
}) {
  const router = useProgressRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const current = searchParams.get(param) ?? ''

  function onChange(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set(param, next)
    else params.delete(param)
    for (const key of resets) params.delete(key)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <Select
      value={current}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className={className}
    >
      {options.map((option) => (
        <option key={option.value || 'all'} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  )
}
