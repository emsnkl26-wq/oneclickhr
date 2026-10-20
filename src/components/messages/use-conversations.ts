'use client'

/**
 * The conversation list, kept live.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE SUBSCRIPTIONS BELOW CARRY NO FILTER, ON PURPOSE                      │
 * │                                                                          │
 * │ Realtime applies the subscriber's own RLS policies to every row before    │
 * │ sending it, so an unfiltered subscription on `messages` delivers exactly  │
 * │ the messages this person is allowed to see — which is precisely the set    │
 * │ that can change this list. A `tenant_id=eq.…` filter would be strictly    │
 * │ WIDER (every room in the workspace, including the ones they are not in,   │
 * │ discarded after the fact) and would need a tenant id threaded down to a    │
 * │ component that otherwise needs nothing.                                   │
 * │                                                                          │
 * │ The thread's own hook does filter, because there it genuinely narrows:    │
 * │ one conversation out of the dozens this person is in.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * An event is a signal, not data: the list's rows carry unread counts, member
 * rosters and a preview the payload has none of, so the hook re-reads the list
 * endpoint. Debounced, so a burst of messages across three rooms is one request.
 */

import * as React from 'react'
import { apiGet, apiPatch, ApiClientError } from '@/lib/fetcher'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { ConversationSummary, MessagingPerson } from '@/lib/messaging-shared'

const REFRESH_DEBOUNCE_MS = 250

export interface ConversationsController {
  conversations: ConversationSummary[]
  people: MessagingPerson[]
  refresh: () => void
  /** Clear a room's badge locally, the moment it is opened. */
  markOpened: (conversationId: string) => void
  setPref: (conversationId: string, pref: { muted?: boolean; pinned?: boolean }) => Promise<void>
}

export function useConversations(args: {
  initialConversations: ConversationSummary[]
  initialPeople: MessagingPerson[]
}): ConversationsController {
  const [conversations, setConversations] = React.useState(args.initialConversations)
  const [people, setPeople] = React.useState(args.initialPeople)

  const load = React.useCallback(async () => {
    try {
      const next = await apiGet<{
        conversations: ConversationSummary[]
        people: MessagingPerson[]
      }>('/api/messaging/conversations')
      setConversations(next.conversations)
      setPeople(next.people)
    } catch {
      // Keep the last good list; the next event or focus tries again.
    }
  }, [])

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const refresh = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void load()
    }, REFRESH_DEBOUNCE_MS)
  }, [load])

  React.useEffect(() => {
    const supabase = createClient()

    const channel = supabase
      .channel('conversations:mine')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, refresh)
      // Being ADDED to a room is the one change that puts a conversation in
      // this list that was not in it a moment ago, and no `messages` event
      // accompanies it.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, refresh)
      .subscribe()

    /*
     * Returning to the tab re-reads once. A socket that dropped while the
     * laptop was asleep reconnects without replaying what it missed, so
     * without this the list would be as stale as the sleep was long.
     */
    const onFocus = () => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [refresh, load])

  /*
   * Zero the badge locally when a conversation is opened, rather than waiting
   * for the read mark to round-trip and the list to be re-read. Opening a room
   * and watching its unread pill linger for half a second is the kind of lag
   * that reads as the app not having noticed the click.
   */
  const markOpened = React.useCallback((conversationId: string) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation
      )
    )
  }, [])

  const setPref = React.useCallback(
    async (conversationId: string, pref: { muted?: boolean; pinned?: boolean }) => {
      const previous = conversations
      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, ...pref } : conversation
        )
      )
      try {
        await apiPatch(`/api/messaging/conversations/${conversationId}/prefs`, pref)
      } catch (err) {
        setConversations(previous)
        toast.error(err instanceof ApiClientError ? err.message : 'That could not be saved')
      }
    },
    [conversations]
  )

  // Pinned first, then recency — the same order the server sorts in, applied
  // again here because a local pin toggle has to move the row immediately.
  const ordered = React.useMemo(
    () =>
      [...conversations].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        return b.lastMessageAt.localeCompare(a.lastMessageAt)
      }),
    [conversations]
  )

  return { conversations: ordered, people, refresh, markOpened, setPref }
}
