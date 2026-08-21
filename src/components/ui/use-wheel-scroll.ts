'use client'

/**
 * Makes a scrollable element respond to the wheel even under a scroll lock.
 *
 * Radix's Dialog locks page scrolling with `react-remove-scroll`, which
 * `preventDefault()`s every wheel event whose target sits outside the dialog
 * node. Popovers (our date picker, our Select) are portalled to `<body>`, so
 * they land outside that node: the list gets a scrollbar and then refuses to
 * scroll. The lock exposes a `shards` escape hatch, but Radix does not forward
 * it, so the list has to move itself.
 *
 * We listen on the element and set `scrollTop` by hand. The lock's cancelled
 * default is irrelevant to that, and the browser's own scrolling is suppressed
 * either way, so there is no double-scroll when no lock is present.
 */

import * as React from 'react'

/** Wheel deltas arrive in pixels, lines or pages; normalise to pixels. */
const LINE_HEIGHT = 16
const PAGE_HEIGHT = 400

export function useWheelScroll(ref: React.RefObject<HTMLElement | null>, active = true) {
  // `active` exists for popovers: the element is portalled in only once the
  // popover opens, long after the hook itself mounted, so the effect has to
  // re-run at that point to find a node to listen on.
  React.useEffect(() => {
    if (!active) return
    const node = ref.current
    if (!node) return

    function onWheel(event: WheelEvent) {
      const el = ref.current
      if (!el) return

      const max = el.scrollHeight - el.clientHeight
      if (max <= 0) return

      const delta =
        event.deltaMode === 1
          ? event.deltaY * LINE_HEIGHT
          : event.deltaMode === 2
            ? event.deltaY * PAGE_HEIGHT
            : event.deltaY

      const next = Math.min(max, Math.max(0, el.scrollTop + delta))
      // At either end let the event through so an outer scroller can take over.
      if (next === el.scrollTop) return

      el.scrollTop = next
      event.preventDefault()
    }

    // Non-passive: a passive listener may not call `preventDefault`.
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [ref, active])
}
