'use client'

/**
 * Page controls for a server-paged list.
 *
 * These are `<Link>`s, not buttons, for three reasons that all matter here: the
 * next page prefetches while the pointer is still on the control, the current
 * page is shareable and survives a reload, and the browser's back button does
 * what everyone expects.
 */

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Pagination({
  page,
  perPage,
  total,
  param = 'page',
  className,
}: {
  page: number
  perPage: number
  total: number
  param?: string
  className?: string
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const lastPage = Math.max(1, Math.ceil(total / perPage))
  const first = total === 0 ? 0 : (page - 1) * perPage + 1
  const last = Math.min(total, page * perPage)

  const hrefFor = (target: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (target <= 1) params.delete(param)
    else params.set(param, String(target))
    const query = params.toString()
    return query ? `${pathname}?${query}` : pathname
  }

  // One page of results needs no controls, and a count still reads as clutter.
  if (total <= perPage) return null

  const step = (direction: -1 | 1, label: string, Icon: typeof ChevronLeft) => {
    const target = page + direction
    const disabled = target < 1 || target > lastPage
    const classes =
      'focus-ring inline-flex size-9 items-center justify-center rounded-lg border border-line bg-card transition'

    if (disabled) {
      return (
        <span aria-disabled className={cn(classes, 'cursor-not-allowed opacity-40')}>
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{label}</span>
        </span>
      )
    }
    return (
      <Link href={hrefFor(target)} scroll={false} aria-label={label} className={cn(classes, 'hover:bg-page')}>
        <Icon className="size-4" aria-hidden />
      </Link>
    )
  }

  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <p className="tabular text-[13px] text-ink-muted">
        {first}–{last} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        {step(-1, 'Previous page', ChevronLeft)}
        <span className="tabular px-1 text-[13px] text-ink-muted">
          {page} / {lastPage}
        </span>
        {step(1, 'Next page', ChevronRight)}
      </div>
    </div>
  )
}
