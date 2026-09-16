'use client'

/**
 * Drag-to-reposition for a fixed-position floating control, persisted locally.
 *
 * WHY LOCALSTORAGE AND NOT THE DATABASE. Where a floating button sits is a
 * property of the screen it is being dragged on, not of the account: the same
 * person wants it bottom-right on a wide monitor and out of the way of the tab
 * bar on a phone. Syncing it would move the button on one device because of
 * something done on another, which is worse than not syncing it at all. It also
 * means no request, no auth and no failure mode on a purely cosmetic preference.
 *
 * STORED AS A RATIO, NOT PIXELS. A position saved on a 2560px monitor and
 * replayed on a 1280px laptop would put the button off-screen. Persisting the
 * fraction of the viewport keeps it in roughly the same visual place at any
 * size, and every read is clamped on top of that so a stale or hand-edited value
 * can never strand the control where it cannot be clicked.
 */

import * as React from 'react'

/** Keep the whole control on screen, with a little breathing room. */
const EDGE_GAP = 8

/** Below this, a pointer-up is a click on the button, not the end of a drag. */
const DRAG_THRESHOLD_PX = 4

interface StoredPosition {
  /** Left edge as a fraction of viewport width. */
  xRatio: number
  /** Top edge as a fraction of viewport height. */
  yRatio: number
}

function clamp(value: number, min: number, max: number): number {
  // `max` can fall below `min` when the element is wider than the viewport.
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function read(key: string): StoredPosition | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredPosition>
    if (!Number.isFinite(parsed.xRatio) || !Number.isFinite(parsed.yRatio)) return null
    return { xRatio: parsed.xRatio as number, yRatio: parsed.yRatio as number }
  } catch {
    // Private mode, blocked site data, or something else wrote nonsense under
    // this key. The default corner is a perfectly good answer.
    return null
  }
}

function write(key: string, position: StoredPosition): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(position))
  } catch {
    // Quota or a blocked store — the button still moves for this session.
  }
}

export interface DraggablePosition {
  ref: React.RefObject<HTMLButtonElement | null>
  style: React.CSSProperties
  dragging: boolean
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
  /** True if the gesture that just ended moved far enough to be a drag. */
  wasDragged: () => boolean
}

export function useDraggablePosition(storageKey: string): DraggablePosition {
  const ref = React.useRef<HTMLButtonElement>(null)
  const [position, setPosition] = React.useState<{ left: number; top: number } | null>(null)
  const [dragging, setDragging] = React.useState(false)

  // Gesture bookkeeping lives in a ref: it changes on every pointermove and
  // nothing renders from it, so putting it in state would be pure re-renders.
  const gesture = React.useRef({ offsetX: 0, offsetY: 0, moved: false, startX: 0, startY: 0 })

  /** Ratio -> pixels for the CURRENT viewport, clamped inside it. */
  const resolve = React.useCallback((stored: StoredPosition) => {
    const el = ref.current
    if (!el) return null
    const { offsetWidth: w, offsetHeight: h } = el
    return {
      left: clamp(stored.xRatio * window.innerWidth, EDGE_GAP, window.innerWidth - w - EDGE_GAP),
      top: clamp(stored.yRatio * window.innerHeight, EDGE_GAP, window.innerHeight - h - EDGE_GAP),
    }
  }, [])

  /*
   * Read AFTER mount, never during render.
   *
   * localStorage does not exist on the server, so seeding state from it would
   * make the first client render disagree with the server's and React would
   * throw a hydration mismatch. The button renders in its default corner for one
   * frame and then moves, which is invisible and correct.
   */
  React.useEffect(() => {
    const stored = read(storageKey)
    if (stored) setPosition(resolve(stored))
  }, [storageKey, resolve])

  // A window resize (or a phone rotating) can leave a pinned button off-screen.
  React.useEffect(() => {
    function onResize() {
      const stored = read(storageKey)
      if (stored) setPosition(resolve(stored))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [storageKey, resolve])

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    // Left button / touch / pen only — a right-click is a context menu.
    if (event.button !== 0) return
    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    gesture.current = {
      // Grab the button where it was actually held, so it does not jump to
      // centre itself under the pointer on the first move.
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
    }

    // Pointer capture is what makes a fast drag survive the pointer leaving the
    // button, and guarantees the matching pointerup arrives here even if it
    // happens over an iframe or outside the window.
    el.setPointerCapture(event.pointerId)
    setDragging(true)
  }, [])

  React.useEffect(() => {
    if (!dragging) return
    const el = ref.current
    if (!el) return

    function onMove(event: PointerEvent) {
      const node = ref.current
      if (!node) return

      const { offsetX, offsetY, startX, startY } = gesture.current
      if (
        Math.abs(event.clientX - startX) > DRAG_THRESHOLD_PX ||
        Math.abs(event.clientY - startY) > DRAG_THRESHOLD_PX
      ) {
        gesture.current.moved = true
      }

      setPosition({
        left: clamp(
          event.clientX - offsetX,
          EDGE_GAP,
          window.innerWidth - node.offsetWidth - EDGE_GAP
        ),
        top: clamp(
          event.clientY - offsetY,
          EDGE_GAP,
          window.innerHeight - node.offsetHeight - EDGE_GAP
        ),
      })
    }

    function onUp() {
      setDragging(false)
      const node = ref.current
      if (!node || !gesture.current.moved) return
      const rect = node.getBoundingClientRect()
      write(storageKey, {
        xRatio: rect.left / window.innerWidth,
        yRatio: rect.top / window.innerHeight,
      })
    }

    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, storageKey])

  const wasDragged = React.useCallback(() => gesture.current.moved, [])

  /*
   * Until a position is known the button keeps its default corner, expressed
   * here rather than in the caller's classes so the two cannot drift apart.
   */
  const style: React.CSSProperties = position
    ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' }
    : { right: 20, bottom: 20 }

  return { ref, style, dragging, onPointerDown, wasDragged }
}
