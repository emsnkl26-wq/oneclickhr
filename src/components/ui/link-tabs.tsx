'use client'

/**
 * Tabs that are ROUTES, not local state.
 *
 * The difference matters for what the server has to do. A `<Tabs>` whose panels
 * are all rendered up front forces the page to fetch every panel's data on every
 * visit, even the ones nobody opens. Making each tab a URL means the server
 * fetches exactly the panel being asked for, and the tab someone never clicks
 * costs nothing.
 *
 * The trade — a round trip on tab change — is paid back by `prefetch`, which
 * warms the panel while the pointer is still over the tab, and by the optimistic
 * highlight below, which moves on the click rather than on the response.
 */

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { usePendingHref } from '@/lib/nav-progress'
import { cn } from '@/lib/utils'

export interface LinkTab {
  /** The `?tab=` value. The first tab may use '' to mean "no param". */
  value: string
  label: React.ReactNode
  /** Rendered as a pill after the label — a count, usually. */
  badge?: React.ReactNode
}

export function LinkTabs({
  tabs,
  active,
  param = 'tab',
  className,
}: {
  tabs: LinkTab[]
  active: string
  param?: string
  className?: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const pendingHref = usePendingHref()

  const hrefFor = React.useCallback(
    (value: string) => {
      // Carry the other params through: a tab switch must not silently drop the
      // week, month or search someone had set.
      const next = new URLSearchParams(searchParams.toString())
      if (value) next.set(param, value)
      else next.delete(param)
      const query = next.toString()
      return query ? `${pathname}?${query}` : pathname
    },
    [pathname, searchParams, param]
  )

  // While a tab navigation is in flight, the destination is the one that looks
  // selected — otherwise the click appears to do nothing until the data lands.
  const pendingTab = React.useMemo(() => {
    if (!pendingHref) return null
    const [path, query] = pendingHref.split('?')
    if (path !== pathname) return null
    const value = new URLSearchParams(query ?? '').get(param) ?? ''
    return tabs.some((tab) => tab.value === value) ? value : null
  }, [pendingHref, pathname, param, tabs])

  const selected = pendingTab ?? active

  return (
    <div
      role="tablist"
      className={cn(
        'no-scrollbar inline-flex items-center gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1',
        className
      )}
    >
      {tabs.map((tab) => {
        const isSelected = tab.value === selected
        return (
          <Link
            key={tab.value || 'default'}
            href={hrefFor(tab.value)}
            role="tab"
            aria-selected={isSelected}
            scroll={false}
            className={cn(
              'focus-ring flex items-center whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition',
              isSelected
                ? 'bg-brand-50 text-brand-700'
                : 'text-ink-muted hover:text-ink'
            )}
          >
            {tab.label}
            {tab.badge ? <span className="ml-2">{tab.badge}</span> : null}
          </Link>
        )
      })}
    </div>
  )
}
