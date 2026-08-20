'use client'

/**
 * Loads the recharts bundle only once the console is on screen.
 *
 * recharts is ~100kB of the /super entry — more than the rest of the page put
 * together — for one small area chart below four stat cards. `ssr: false` keeps
 * it out of the server render and out of the initial JavaScript, so the numbers
 * anyone actually came for paint first and the chart fills in a moment later.
 *
 * The placeholder is exactly the chart's height, so nothing shifts when it
 * arrives.
 */

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/patterns'

export const SignupsChart = dynamic(
  () => import('./signups-chart').then((mod) => mod.SignupsChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-56 w-full rounded-lg" />,
  }
)
