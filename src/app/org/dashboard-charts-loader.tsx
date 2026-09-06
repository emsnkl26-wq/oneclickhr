'use client'

/**
 * Loads the recharts bundle only once the dashboard is on screen.
 *
 * `/org` is the page every org user lands on, and it was the heaviest route in
 * the product by an order of magnitude — 107kB of route JavaScript against
 * 2-13kB for every other page. Almost all of it was `recharts`, imported
 * statically for two plots that sit below the fold, behind the numbers and the
 * action buttons people actually arrive to use. `/super` already loaded the same
 * library this way and shipped 2kB; this brings `/org` in line with it.
 *
 * `ssr: false` keeps the library out of the server render and out of the initial
 * client bundle, so the metric cards paint on the first pass and the plots fill
 * in a moment later.
 *
 * The placeholders are EXACTLY the heights the charts occupy (220px and 140px,
 * matching the wrappers in `dashboard-charts.tsx`), so nothing below them shifts
 * when the real plots arrive.
 */

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/patterns'

export const AttendanceTrend = dynamic(
  () => import('./dashboard-charts').then((mod) => mod.AttendanceTrend),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full rounded-lg" />,
  }
)

export const HoursTrend = dynamic(
  () => import('./dashboard-charts').then((mod) => mod.HoursTrend),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[140px] w-full rounded-lg" />,
  }
)
