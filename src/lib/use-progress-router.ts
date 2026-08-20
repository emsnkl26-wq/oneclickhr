'use client'

/**
 * `useRouter()` that tells the progress bar what it is doing.
 *
 * A click on a `<Link>` is caught by the global listener in `RouteProgress`, but
 * a `router.push()` from a filter control or a wizard has no DOM event behind
 * it. Anything that navigates in code should reach for this instead, so the two
 * paths feel identical to the person waiting.
 */
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { startNavigation } from '@/lib/nav-progress'

export function useProgressRouter() {
  const router = useRouter()

  return React.useMemo(
    () => ({
      ...router,
      push(href: string, options?: Parameters<typeof router.push>[1]) {
        startNavigation(href)
        router.push(href, options)
      },
      replace(href: string, options?: Parameters<typeof router.replace>[1]) {
        startNavigation(href)
        router.replace(href, options)
      },
    }),
    [router]
  )
}
