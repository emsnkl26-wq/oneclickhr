'use client'

/**
 * A three-line store for "a navigation is in flight".
 *
 * It exists because the App Router has no navigation events. Two very different
 * consumers need the same answer — the top progress bar, and the sidebar item
 * that should light up the instant it is clicked rather than when the server
 * answers — so the state lives outside React and is read with
 * `useSyncExternalStore`. That keeps it a single source of truth without
 * threading a context provider through the server-rendered shell.
 *
 * `pendingHref` is the destination, not a boolean, so the sidebar can tell WHICH
 * link is pending.
 */
import * as React from 'react'

type Listener = () => void

let pendingHref: string | null = null
let timeoutId: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

/**
 * A navigation that never lands (an external redirect, a hard failure) must not
 * leave the bar creeping forever.
 */
const STUCK_AFTER_MS = 20_000

function emit() {
  for (const listener of listeners) listener()
}

export function startNavigation(href: string): void {
  if (pendingHref === href) return
  pendingHref = href
  if (timeoutId) clearTimeout(timeoutId)
  timeoutId = setTimeout(endNavigation, STUCK_AFTER_MS)
  emit()
}

export function endNavigation(): void {
  if (timeoutId) {
    clearTimeout(timeoutId)
    timeoutId = null
  }
  if (pendingHref === null) return
  pendingHref = null
  emit()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = () => pendingHref
// The server has no in-flight navigation, and returning a stable value here is
// what keeps `useSyncExternalStore` from tearing during hydration.
const getServerSnapshot = () => null

/** The href currently being navigated to, or null. */
export function usePendingHref(): string | null {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
