'use client'

/**
 * The stateful shell around `CalendarView`.
 *
 * The period lives in the URL, not in React state, so a particular month is a
 * link somebody can send — and so paging back re-runs the SERVER query for that
 * period rather than filtering a fixed window in the browser. A calendar that
 * only holds the month it was rendered with quietly shows an empty December.
 */

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarView, type CalendarMode } from './calendar-view'
import type { CalendarEvent } from '@/lib/calendar-kinds'

export function CalendarWorkspace({
  events, anchor, mode, today, timezone, basePath,
}: {
  events: CalendarEvent[]
  anchor: string
  mode: CalendarMode
  today: string
  timezone: string
  basePath: string
}) {
  const router = useRouter()
  const params = useSearchParams()

  const go = React.useCallback(
    (next: { anchor?: string; mode?: CalendarMode }) => {
      const query = new URLSearchParams(params.toString())
      if (next.anchor) query.set('date', next.anchor)
      if (next.mode) query.set('view', next.mode)
      router.push(`${basePath}?${query.toString()}`)
    },
    [params, router, basePath]
  )

  return (
    <CalendarView
      events={events}
      anchor={anchor}
      mode={mode}
      today={today}
      timezone={timezone}
      onNavigate={(nextAnchor) => go({ anchor: nextAnchor })}
      onModeChange={(nextMode) => go({ mode: nextMode })}
    />
  )
}
