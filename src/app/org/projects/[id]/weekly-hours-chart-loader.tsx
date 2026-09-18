'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/patterns'

/** Client-only, so recharts is not in the project page's initial bundle. */
export const WeeklyHoursChart = dynamic(
  () => import('./weekly-hours-chart').then((mod) => mod.WeeklyHoursChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[180px] w-full rounded-lg" />,
  }
)
