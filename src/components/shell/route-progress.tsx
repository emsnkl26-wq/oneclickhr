'use client'

import * as React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { endNavigation, startNavigation, usePendingHref } from '@/lib/nav-progress'

/**
 * The thin brand-coloured bar across the top of every page.
 *
 * WHY IT EXISTS: every route in this app is dynamic and server-rendered, so a
 * click has real latency behind it. Without an acknowledgement the UI looks
 * frozen and people click again. The bar appears on the SAME tick as the click —
 * before any request is even sent — so the feedback is instant regardless of how
 * long the server takes.
 *
 * HOW IT KNOWS: the App Router exposes no navigation events, so we bracket it
 * ourselves. A capture-phase click listener catches every in-app `<a>` (which is
 * what `next/link` renders), `useProgressRouter()` covers programmatic pushes,
 * and the arrival of a new pathname/search pair is what counts as "done".
 *
 * It never reaches 100% while waiting — a bar that fills and then sits there is
 * a worse lie than one that is visibly still working.
 */

/** How far the bar creeps while the server is still thinking. */
const CEILING = 92
/** How often it creeps. Cheap on purpose: CSS does the interpolation. */
const TICK_MS = 220
/** Stops a sub-100ms navigation from flashing a one-frame sliver. */
const MIN_VISIBLE_MS = 280
/** Time the filled bar stays at 100% before fading out. */
const FADE_MS = 200

function ProgressBar() {
  const pending = usePendingHref()
  const barRef = React.useRef<HTMLDivElement | null>(null)
  const progress = React.useRef(0)
  const shownAt = React.useRef(0)

  React.useEffect(() => {
    const bar = barRef.current
    if (!bar) return

    const paint = (value: number, opacity: number) => {
      progress.current = value
      bar.style.transform = `scaleX(${value / 100})`
      bar.style.opacity = String(opacity)
    }

    if (pending !== null) {
      shownAt.current = Date.now()
      // No transition on the reset, or the bar visibly rewinds from wherever the
      // previous navigation left it.
      bar.style.transition = 'none'
      paint(0, 1)
      // Force a reflow so the browser commits the reset before the transition is
      // re-enabled; without it the two style writes coalesce into one frame.
      void bar.offsetWidth
      bar.style.transition = `transform ${TICK_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms linear`
      // A visible head immediately — the whole point is acknowledging the click.
      paint(18, 1)

      const timer = setInterval(() => {
        // Asymptotic: fast while there is room, barely moving near the ceiling.
        const next = Math.min(CEILING, progress.current + (CEILING - progress.current) * 0.28)
        paint(next, 1)
      }, TICK_MS)

      return () => clearInterval(timer)
    }

    // Nothing was ever shown (first mount, or an end with no start).
    if (progress.current === 0) return

    const remaining = Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt.current))
    const fill = setTimeout(() => paint(100, 1), remaining)
    const fade = setTimeout(() => paint(100, 0), remaining + FADE_MS)
    const reset = setTimeout(() => {
      const node = barRef.current
      if (!node) return
      node.style.transition = 'none'
      paint(0, 0)
    }, remaining + FADE_MS + 220)

    return () => {
      clearTimeout(fill)
      clearTimeout(fade)
      clearTimeout(reset)
    }
  }, [pending])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px]"
    >
      <div
        ref={barRef}
        className="h-full w-full origin-left bg-brand-600 opacity-0 shadow-[0_0_10px_1px_hsl(var(--brand-600)/0.6)]"
        style={{ transform: 'scaleX(0)' }}
      />
    </div>
  )
}

/**
 * Decide whether a click is an in-app navigation we own.
 *
 * Everything this returns false for is a case where the BROWSER already gives
 * feedback (a full page load, a download, a new tab) or where nothing is
 * navigating at all (a modifier-click, a hash jump, the current URL).
 */
function navigationTargetOf(event: MouseEvent): string | null {
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null

  const target = event.target
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a')
  if (!anchor) return null

  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#')) return null
  if (anchor.hasAttribute('download')) return null
  if (anchor.target && anchor.target !== '_self') return null

  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return null
  }

  if (url.origin !== window.location.origin) return null
  // API routes leave the SPA entirely (file downloads, sign-out); the browser's
  // own progress indicator takes over there.
  if (url.pathname.startsWith('/api/')) return null
  if (url.pathname + url.search === window.location.pathname + window.location.search) return null

  return url.pathname + url.search
}

function NavigationSignals() {
  const pathname = usePathname()
  // The STRING, not the object. Depending on the params object itself would tie
  // this effect to an identity we do not control, and an effect that re-ran on
  // an unrelated render would end the navigation the instant it began.
  const search = useSearchParams().toString()

  // A committed render at a new URL is the definition of "arrived". With a
  // `loading.tsx` in place that commit happens as soon as the skeleton shows,
  // which is exactly when the bar should hand over.
  React.useEffect(() => {
    endNavigation()
  }, [pathname, search])

  React.useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const destination = navigationTargetOf(event)
      if (destination) startNavigation(destination)
    }
    // Capture phase: a handler that calls `preventDefault` further down must not
    // rob us of the signal, and `next/link` stops nothing at this stage.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])

  return null
}

export function RouteProgress() {
  return (
    <>
      {/* `useSearchParams` opts its subtree into client rendering; the boundary
          keeps that from spreading any further than the listener itself. */}
      <React.Suspense fallback={null}>
        <NavigationSignals />
      </React.Suspense>
      <ProgressBar />
    </>
  )
}
