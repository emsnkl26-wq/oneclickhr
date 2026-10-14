'use client'

/**
 * The count beside "Messages" in the sidebar.
 *
 * ONE COUNT PER TAB, like the notification bell's inbox. The rail renders a nav
 * item in more than one place — desktop rail, mobile drawer — and only CSS
 * decides which is visible, so the count lives in a module-level store rather
 * than in each instance: one subscription, one fetch, and both copies agree.
 *
 * REALTIME, NOT POLLED, and the difference is the point of the feature. The
 * bell polls once a minute because an announcement that arrives 40 seconds
 * later is still an announcement; a message that arrives a minute late is a
 * conversation somebody has already given up on. The subscription carries no
 * filter, so Realtime's own RLS check means it delivers exactly the messages
 * this person can see — see the box in `use-conversations.ts`.
 *
 * A focus listener backs it up, because a socket that dropped while the laptop
 * slept reconnects without replaying what it missed.
 */

import * as React from 'react'
import { apiGet } from '@/lib/fetcher'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface Unread {
  total: number
  rooms: number
}

const REFRESH_DEBOUNCE_MS = 400

const store: {
  unread: Unread | null
  listeners: Set<() => void>
  stop: (() => void) | null
} = { unread: null, listeners: new Set(), stop: null }

function publish(next: Unread | null) {
  store.unread = next
  store.listeners.forEach((listener) => listener())
}

async function load() {
  try {
    publish(await apiGet<Unread>('/api/messaging/unread'))
  } catch {
    // A failed count keeps the last one. It was right a moment ago.
  }
}

function start(): () => void {
  void load()

  const supabase = createClient()
  let timer: ReturnType<typeof setTimeout> | undefined
  const bump = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void load(), REFRESH_DEBOUNCE_MS)
  }

  const channel = supabase
    .channel('messaging:badge')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, bump)
    // A read mark in ANOTHER tab lowers the count in this one.
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members' }, bump)
    .subscribe()

  const onFocus = () => {
    if (document.visibilityState === 'visible') void load()
  }
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onFocus)

  return () => {
    if (timer) clearTimeout(timer)
    supabase.removeChannel(channel)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onFocus)
  }
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener)
  if (!store.stop) store.stop = start()
  return () => {
    store.listeners.delete(listener)
    if (!store.listeners.size && store.stop) {
      store.stop()
      store.stop = null
    }
  }
}

/** The number of CONVERSATIONS waiting, which is what a nav badge should say. */
export function useUnreadMessages(): Unread | null {
  return React.useSyncExternalStore(subscribe, () => store.unread, () => null)
}

export function MessagesBadge({ className }: { className?: string }) {
  const unread = useUnreadMessages()
  const rooms = unread?.rooms ?? 0
  if (rooms < 1) return null

  return (
    <span
      className={cn(
        'ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 ' +
          'text-[11px] font-semibold leading-none text-white',
        className
      )}
      aria-label={`${rooms} ${rooms === 1 ? 'conversation' : 'conversations'} with unread messages`}
    >
      {rooms > 9 ? '9+' : rooms}
    </span>
  )
}

/**
 * The same count as a bare dot, for the collapsed rail.
 *
 * A number is unreadable at that width and a `+` is worse, so the collapsed
 * state answers only the question it has room for: is there anything.
 */
export function MessagesDot({ className }: { className?: string }) {
  const unread = useUnreadMessages()
  if (!unread?.rooms) return null
  return (
    <span
      className={cn(
        'absolute right-1.5 top-1.5 size-2 rounded-full bg-brand-600 ring-2 ring-sidebar',
        className
      )}
      aria-hidden
    />
  )
}
