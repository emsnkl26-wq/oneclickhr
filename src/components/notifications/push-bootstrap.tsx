'use client'

import * as React from 'react'
import { ensurePushSubscription } from '@/lib/push/client'

/**
 * Keeps this browser's push registration current. RENDERS NOTHING.
 *
 * Mounted once, in the app shell, so it runs for every signed-in page in both
 * portals. That placement is the point: a subscription is not a thing you set up
 * once and own forever — the browser rotates the endpoint on its own schedule,
 * the service worker can be evicted under storage pressure, a VAPID rotation
 * invalidates every endpoint minted against the old key, and
 * `pushsubscriptionchange` is not fired dependably by every engine. Re-announcing
 * on each page load means the server's idea of this device is never more than one
 * navigation stale, and it costs one small POST against a page that is already
 * doing several.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ IT NEVER PROMPTS, AND THAT IS NOT A STYLE PREFERENCE.                  │
 * │                                                                        │
 * │ Chrome permanently blocks an origin that requests notification         │
 * │ permission without a user gesture — one automatic prompt and NOBODY in │
 * │ the workspace can ever be asked again on that device. So this only     │
 * │ ever refreshes a permission that has ALREADY been granted;             │
 * │ `ensurePushSubscription` returns early otherwise, and asking is left   │
 * │ entirely to the button in <PushToggle>.                                │
 * └────────────────────────────────────────────────────────────────────────┘
 */
export function PushBootstrap() {
  React.useEffect(() => {
    let cancelled = false

    /*
     * Deferred past first paint. Registering a service worker and talking to a
     * push service competes for the main thread with hydration, and nothing here
     * is urgent — the notification it might carry has already been written and is
     * already in the portal. `requestIdleCallback` where it exists, a short
     * timeout on Safari, which still does not implement it.
     */
    const run = () => {
      if (cancelled) return
      // Fire and forget: `ensurePushSubscription` resolves to a state and never
      // rejects, and there is no UI here to tell about it either way.
      void ensurePushSubscription()
    }

    /*
     * Safari still does not implement `requestIdleCallback`, so the check below
     * is a real one — TypeScript's DOM library declares it as always present,
     * which is why `window` is re-typed here with the two members marked
     * optional. Without that the compiler collapses the guard to "always true"
     * and the Safari path becomes unreachable code that is nonetheless the one
     * that runs there.
     */
    const win = window as unknown as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }

    let cancelScheduled: () => void
    if (win.requestIdleCallback) {
      const handle = win.requestIdleCallback(run, { timeout: 4000 })
      cancelScheduled = () => win.cancelIdleCallback?.(handle)
    } else {
      const handle = window.setTimeout(run, 1200)
      cancelScheduled = () => window.clearTimeout(handle)
    }

    return () => {
      cancelled = true
      cancelScheduled()
    }
  }, [])

  return null
}
