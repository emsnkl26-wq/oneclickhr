'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Select, DateField } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useProgressRouter } from '@/lib/use-progress-router'
import { RANGE_LABELS, RANGE_PRESETS, type RangePreset } from './finance-data'

/**
 * The window the overview covers, kept in the URL (`?range=…&from=…&to=…`) so a
 * view can be bookmarked or shared and the server does the querying.
 */
export function RangePicker({
  preset, from, to,
}: {
  preset: RangePreset
  from: string
  to: string
}) {
  const router = useProgressRouter()
  const pathname = usePathname()
  const [mode, setMode] = React.useState<RangePreset>(preset)
  const [customFrom, setCustomFrom] = React.useState(from)
  const [customTo, setCustomTo] = React.useState(to)

  React.useEffect(() => {
    setMode(preset)
    setCustomFrom(from)
    setCustomTo(to)
  }, [preset, from, to])

  function go(params: Record<string, string>) {
    const query = new URLSearchParams(params).toString()
    router.replace(`${pathname}?${query}`, { scroll: false })
  }

  function onPreset(next: RangePreset) {
    setMode(next)
    if (next !== 'custom') go({ range: next })
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
      <Select
        aria-label="Date range"
        className="sm:w-44"
        value={mode}
        onChange={(e) => onPreset(e.target.value as RangePreset)}
      >
        {RANGE_PRESETS.map((value) => (
          <option key={value} value={value}>{RANGE_LABELS[value]}</option>
        ))}
      </Select>
      {mode === 'custom' ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (customFrom && customTo) go({ range: 'custom', from: customFrom, to: customTo })
          }}
        >
          <DateField
            aria-label="From"
            value={customFrom}
            max={customTo || undefined}
            onChange={(e) => setCustomFrom(e.target.value)}
            required
          />
          <span className="pb-2 text-sm text-ink-muted">to</span>
          <DateField
            aria-label="To"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => setCustomTo(e.target.value)}
            required
          />
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
      ) : null}
    </div>
  )
}
