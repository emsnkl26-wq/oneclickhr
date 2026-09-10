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

/** Scroll `el` by one wheel event. Returns false if it was already at the end. */
function scrollBy(el: HTMLElement, event: WheelEvent): boolean {
  const max = el.scrollHeight - el.clientHeight
  if (max <= 0) return false

  const delta =
    event.deltaMode === 1
      ? event.deltaY * LINE_HEIGHT
      : event.deltaMode === 2
        ? event.deltaY * PAGE_HEIGHT
        : event.deltaY

  const next = Math.min(max, Math.max(0, el.scrollTop + delta))
  // At either end let the event through so an outer scroller can take over.
  if (next === el.scrollTop) return false

  el.scrollTop = next
  return true
}

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
      if (el && scrollBy(el, event)) event.preventDefault()
    }

    // Non-passive: a passive listener may not call `preventDefault`.
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [ref, active])
}

/**
 * The same thing, as a CALLBACK REF.
 *
 * `useWheelScroll` attaches from an effect, which means it depends on the node
 * already being in `ref.current` by the time that effect runs. For a list that
 * is portalled in by Radix's `Presence` that is a race, and when it is lost the
 * listener is simply never attached — the symptom being a dropdown inside a
 * dialog that shows a scrollbar and then ignores the wheel entirely.
 *
 * A callback ref has no such window: React hands us the node at the moment it
 * enters the DOM, and hands us `null` when it leaves. Nothing to re-run, nothing
 * to miss.
 */
export function useWheelScrollRef<T extends HTMLElement>(): (node: T | null) => void {
  const cleanup = React.useRef<(() => void) | null>(null)

  return React.useCallback((node: T | null) => {
    cleanup.current?.()
    cleanup.current = null
    if (!node) return

    const onWheel = (event: WheelEvent) => {
      if (scrollBy(node, event)) event.preventDefault()
    }

    node.addEventListener('wheel', onWheel, { passive: false })
    cleanup.current = () => node.removeEventListener('wheel', onWheel)
  }, [])
}
