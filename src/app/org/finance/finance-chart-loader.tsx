'use client'

/**
 * Loads the recharts bundle on the client only — same pattern and reasoning as
 * `../dashboard-charts-loader.tsx`. Placeholders match the chart heights so
 * nothing shifts when the plots arrive.
 */

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/patterns'

export const EarnedSpentChart = dynamic(
  () => import('./finance-chart').then((mod) => mod.EarnedSpentChart),
  { ssr: false, loading: () => <Skeleton className="h-[348px] w-full rounded-lg" /> }
)

export const CumulativeNetChart = dynamic(
  () => import('./finance-chart').then((mod) => mod.CumulativeNetChart),
  { ssr: false, loading: () => <Skeleton className="h-[180px] w-full rounded-lg" /> }
)
