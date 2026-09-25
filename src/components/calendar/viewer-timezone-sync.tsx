'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { VIEWER_TZ_COOKIE, browserTimezone } from '@/lib/viewer-timezone-shared'

/**
 * Tell the server which timezone this browser is in, once.
 *
 * The page was rendered in `renderedIn`. When the browser's own zone differs,
 * the cookie is written and the page re-rendered on the server, so the grid
 * and every time on it move onto the viewer's clock. When they already agree
 * nothing happens — which is every visit after the first.
 */
export function ViewerTimezoneSync({ renderedIn }: { renderedIn: string }) {
  const router = useRouter()

  React.useEffect(() => {
    const zone = browserTimezone()
    if (!zone || zone === renderedIn) return
    /*
     * Once per zone per tab. Should the server ever refuse this zone (and fall
     * back to the workspace's), the page would otherwise come back still
     * "wrong" and refresh itself forever.
     */
    const marker = `${VIEWER_TZ_COOKIE}:tried`
    try {
      if (sessionStorage.getItem(marker) === zone) return
      sessionStorage.setItem(marker, zone)
    } catch {
      // Storage blocked: fall through — the cookie write below is idempotent,
      // and without a marker the refresh is simply not repeated this mount.
    }
    // A year: a laptop that travels simply rewrites it on the next visit.
    document.cookie = `${VIEWER_TZ_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax${
      window.location.protocol === 'https:' ? '; secure' : ''
    }`
    router.refresh()
  }, [renderedIn, router])

  return null
}
