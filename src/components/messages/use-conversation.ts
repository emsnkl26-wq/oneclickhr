'use client'

/**
 * One conversation's live state: the thread, who is typing, and every mutation
 * a bubble can be the subject of.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A REALTIME EVENT TRIGGERS A FETCH RATHER THAN PATCHING FROM ITS      │
 * │ PAYLOAD                                                                  │
 * │                                                                          │
 * │ A Postgres change event carries one row of one table. A bubble is a       │
 * │ `messages` row PLUS its attachments, its reactions, its sender's photo    │
 * │ and the message it quotes — four joins the payload does not have and      │
 * │ cannot be made to have. Patching from it would render every incoming      │
 * │ photo as an empty bubble that fills in later, if at all.                  │
 * │                                                                          │
 * │ So an event is treated as a SIGNAL, never as data, and the hook asks the  │
 * │ API what changed. Two shapes of ask, because they cost very differently:  │
 * │                                                                          │
 * │   • a new message → `?after=<newest I hold>`, which returns only what     │
 * │     has appeared. The common case, and it is O(new).                      │
 * │   • an edit, a retraction, a reaction, a pin → re-read the tail and       │
 * │     merge by id. Nothing in a change payload can tell us WHICH bubble      │
 * │     is stale without re-deriving its reaction tally anyway, so the tail   │
 * │     is the cheapest honest answer.                                        │
 * │                                                                          │
 * │ Both are debounced together, so a burst — somebody pasting four images,   │
 * │ which is four message rows and four attachment rows — is one round trip.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * OPTIMISTIC SENDS, and the one thing that makes them safe. A sent message is
 * drawn immediately with a `clientToken`, which the server stores under a unique
 * index. So the same token can only ever produce one row: a retry after a
 * dropped response returns the original instead of posting a second copy, and
 * the realtime echo of our own message is recognised by its token and replaces
 * the optimistic bubble rather than appearing beside it.
 *
 * The subscription runs on the user's OWN session, so Postgres applies
 * `messages_select` to this subscriber — someone who is not in the conversation
 * cannot receive its events even though the channel name is guessable. The
 * `conversation_id` filter is a bandwidth optimisation, not the boundary.
 */

import * as React from 'react'
import { toast } from 'sonner'
import { apiGet, apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { createClient } from '@/lib/supabase/client'
import type {
  ConversationDetail,
  ConversationMemberView,
  MessageView,
} from '@/lib/messaging-shared'

/** Long enough to absorb one paste of several images, short enough to feel live. */
const SYNC_DEBOUNCE_MS = 180
/** How much of the tail an edit/reaction/pin event re-reads. */
const TAIL_REFRESH = 40
/** A typing flag nobody refreshed is stale; the sender may simply have closed the tab. */
const TYPING_TTL_MS = 5000
/** How often a still-typing composer re-announces itself. */
export const TYPING_PING_MS = 2500

export interface TypingPerson {
  id: string
  name: string
  at: number
}

export interface OutgoingFile {
  key: string
  name: string
  contentType: string
  sizeBytes: number
  durationSeconds?: number
  width?: number
  height?: number
}

export interface ConversationController {
  detail: ConversationDetail
  messages: MessageView[]
  members: ConversationMemberView[]
  typing: TypingPerson[]
  /** Older history is still available above. */
  hasMore: boolean
  loadingMore: boolean
  send: (input: {
    body: string | null
    replyToId?: string | null
    attachments?: OutgoingFile[]
  }) => Promise<boolean>
  /** Re-send a bubble whose POST failed, with the SAME token. */
  retry: (localId: string) => Promise<void>
  /** Drop a failed bubble without sending it. */
  discard: (localId: string) => void
  loadOlder: () => Promise<void>
  edit: (messageId: string, body: string) => Promise<boolean>
  remove: (messageId: string) => Promise<void>
  react: (messageId: string, emoji: string, on: boolean) => Promise<void>
  pin: (messageId: string, pinned: boolean) => Promise<void>
  announceTyping: () => void
  refresh: () => void
}

export function useConversation(args: {
  initial: ConversationDetail
  viewerId: string
  viewerName: string
  tenantId: string
}): ConversationController {
  const conversationId = args.initial.conversation.id

  const [detail, setDetail] = React.useState(args.initial)
  const [messages, setMessages] = React.useState<MessageView[]>(args.initial.messages)
  const [members, setMembers] = React.useState(args.initial.members)
  const [hasMore, setHasMore] = React.useState(!args.initial.atStart)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [typing, setTyping] = React.useState<TypingPerson[]>([])

  // Navigating between conversations re-uses this hook, so adopting the new
  // props is what resets the thread. Keyed on the id so a REFRESH of the same
  // conversation does not throw away messages realtime has since appended.
  React.useEffect(() => {
    setDetail(args.initial)
    setMessages(args.initial.messages)
    setMembers(args.initial.members)
    setHasMore(!args.initial.atStart)
    setTyping([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  /*
   * The newest confirmed timestamp. A ref rather than state because the sync
   * effect reads it from inside a debounce timer, and a stale closure here
   * would ask for messages "after" a time that has already passed — silently
   * re-fetching what we hold, or worse, missing what we do not.
   *
   * Optimistic bubbles are excluded: their `createdAt` is this browser's clock,
   * which may run ahead of the database's, and using it as a lower bound would
   * skip real messages written in between.
   */
  const newestConfirmed = React.useRef<string | null>(
    lastConfirmedAt(args.initial.messages)
  )

  React.useEffect(() => {
    newestConfirmed.current = lastConfirmedAt(messages) ?? newestConfirmed.current
  }, [messages])

  /** Merge a page of server truth into what we hold, by id. */
  const absorb = React.useCallback((incoming: MessageView[]) => {
    if (!incoming.length) return
    setMessages((current) => mergeMessages(current, incoming))
  }, [])

  const syncNew = React.useCallback(async () => {
    const after = newestConfirmed.current
    try {
      const params = new URLSearchParams({ limit: String(TAIL_REFRESH) })
      if (after) params.set('after', after)
      const page = await apiGet<{ messages: MessageView[] }>(
        `/api/messaging/conversations/${conversationId}/messages?${params.toString()}`
      )
      absorb(page.messages)
    } catch {
      // A failed sync keeps what we have; the next event asks again.
    }
  }, [conversationId, absorb])

  const syncTail = React.useCallback(async () => {
    try {
      const page = await apiGet<{ messages: MessageView[] }>(
        `/api/messaging/conversations/${conversationId}/messages?limit=${TAIL_REFRESH}`
      )
      absorb(page.messages)
    } catch {
      // As above.
    }
  }, [conversationId, absorb])

  const refresh = React.useCallback(() => {
    void syncTail()
  }, [syncTail])

  /* ------------------------------------------------------------- realtime */

  React.useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | undefined
    // Which kind of ask the pending sync should make. An INSERT alone can be
    // answered with `after`; anything else in the same burst forces the tail.
    let wantTail = false

    const schedule = (tail: boolean) => {
      if (tail) wantTail = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const asTail = wantTail
        wantTail = false
        void (asTail ? syncTail() : syncNew())
      }, SYNC_DEBOUNCE_MS)
    }

    const channel = supabase
      .channel(`conversation:${conversationId}`, {
        // Our own typing pings must not come back to us.
        config: { broadcast: { self: false } },
      })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        () => schedule(false)
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        () => schedule(true)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions', filter: `conversation_id=eq.${conversationId}` },
        () => schedule(true)
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_attachments', filter: `conversation_id=eq.${conversationId}` },
        () => schedule(true)
      )
      /*
       * Read receipts and the roster. These ARE patched from the payload,
       * unlike messages, because a membership row is the whole fact — there is
       * nothing to join to it — and re-reading the roster on every read mark
       * would be a request per person per message in a busy room.
       */
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            | { profile_id?: string; last_read_at?: string | null }
            | undefined
          if (!row?.profile_id) return
          if (payload.eventType === 'DELETE') {
            setMembers((current) => current.filter((member) => member.id !== row.profile_id))
            return
          }
          setMembers((current) =>
            current.map((member) =>
              member.id === row.profile_id
                ? { ...member, lastReadAt: row.last_read_at ?? member.lastReadAt }
                : member
            )
          )
        }
      )
      .on('broadcast', { event: 'typing' }, (payload) => {
        const who = payload.payload as { id?: string; name?: string } | undefined
        const id = who?.id
        if (!id || id === args.viewerId) return
        const name = who?.name || 'Someone'
        setTyping((current) => [
          ...current.filter((person) => person.id !== id),
          { id, name, at: Date.now() },
        ])
      })
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [conversationId, syncNew, syncTail, args.viewerId])

  /*
   * Expire typing flags on a timer rather than on a "stopped typing" message.
   * A browser that is closed, backgrounded or offline never sends one, and a
   * dot that says somebody is typing forever is worse than one that is a few
   * seconds late to disappear. The interval only runs while somebody is.
   */
  React.useEffect(() => {
    if (!typing.length) return
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - TYPING_TTL_MS
      setTyping((current) => {
        const next = current.filter((person) => person.at > cutoff)
        return next.length === current.length ? current : next
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [typing.length])

  const announceTyping = React.useCallback(() => {
    const supabase = createClient()
    // The channel is already open from the effect above; `channel()` returns
    // the live instance for a name it is already subscribed to.
    void supabase.channel(`conversation:${conversationId}`).send({
      type: 'broadcast',
      event: 'typing',
      payload: { id: args.viewerId, name: args.viewerName },
    })
  }, [conversationId, args.viewerId, args.viewerName])

  /* ------------------------------------------------------------ mutations */

  const post = React.useCallback(
    async (bubble: MessageView, attachments: OutgoingFile[]): Promise<boolean> => {
      try {
        await apiPost(`/api/messaging/conversations/${conversationId}/messages`, {
          body: bubble.body,
          replyToId: bubble.replyTo?.id ?? null,
          attachments,
          clientToken: bubble.clientToken,
        })
        /*
         * The row now exists. We do NOT swap the optimistic bubble for the
         * response here: the realtime echo arrives with the attachments and
         * reactions hydrated, and `mergeMessages` matches it to this bubble by
         * its token. Patching from the POST's thin answer would redraw the
         * photo as a blank and then fill it in again.
         */
        void syncNew()
        return true
      } catch (err) {
        setMessages((current) =>
          current.map((message) =>
            message.id === bubble.id ? { ...message, status: 'failed' } : message
          )
        )
        if (err instanceof ApiClientError && err.status !== 0) toast.error(err.message)
        return false
      }
    },
    [conversationId, syncNew]
  )

  const pendingFiles = React.useRef(new Map<string, OutgoingFile[]>())

  const send = React.useCallback(
    async (input: {
      body: string | null
      replyToId?: string | null
      attachments?: OutgoingFile[]
    }): Promise<boolean> => {
      const attachments = input.attachments ?? []
      const token = newToken()
      const quoted = input.replyToId
        ? messages.find((message) => message.id === input.replyToId)
        : undefined

      const bubble: MessageView = {
        id: token,
        conversationId,
        senderId: args.viewerId,
        senderName: args.viewerName,
        senderPhotoUrl: null,
        kind: 'text',
        body: input.body,
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
        pinned: false,
        mine: true,
        mentions: [],
        systemEvent: null,
        replyTo: quoted
          ? {
              id: quoted.id,
              senderName: quoted.senderName,
              body: quoted.body,
              kind: quoted.kind,
              deleted: quoted.deleted,
            }
          : null,
        // An optimistic bubble shows the TEXT immediately and the attachments
        // when the server confirms them. Drawing a local blob preview would
        // mean two sources for the same image and a visible swap.
        attachments: [],
        reactions: [],
        status: 'sending',
        clientToken: token,
      }

      pendingFiles.current.set(token, attachments)
      setMessages((current) => [...current, bubble])
      return post(bubble, attachments)
    },
    [conversationId, messages, args.viewerId, args.viewerName, post]
  )

  const retry = React.useCallback(
    async (localId: string) => {
      const bubble = messages.find((message) => message.id === localId)
      if (!bubble?.clientToken) return
      setMessages((current) =>
        current.map((message) =>
          message.id === localId ? { ...message, status: 'sending' } : message
        )
      )
      // The SAME token as the first attempt, which is what makes a retry safe:
      // if the original POST actually landed, the server returns that row
      // instead of writing a second one.
      await post(bubble, pendingFiles.current.get(bubble.clientToken) ?? [])
    },
    [messages, post]
  )

  const discard = React.useCallback((localId: string) => {
    setMessages((current) => current.filter((message) => message.id !== localId))
  }, [])

  const loadOlder = React.useCallback(async () => {
    if (loadingMore || !hasMore) return
    const oldest = messages.find((message) => !message.status)
    if (!oldest) return
    setLoadingMore(true)
    try {
      const page = await apiGet<{ messages: MessageView[]; atStart: boolean }>(
        `/api/messaging/conversations/${conversationId}/messages?before=${encodeURIComponent(oldest.createdAt)}`
      )
      absorb(page.messages)
      setHasMore(!page.atStart)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not load older messages')
    } finally {
      setLoadingMore(false)
    }
  }, [conversationId, messages, hasMore, loadingMore, absorb])

  const edit = React.useCallback(
    async (messageId: string, body: string): Promise<boolean> => {
      const previous = messages
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, body, editedAt: new Date().toISOString() }
            : message
        )
      )
      try {
        await apiPatch(`/api/messaging/messages/${messageId}`, { body })
        return true
      } catch (err) {
        setMessages(previous)
        toast.error(err instanceof ApiClientError ? err.message : 'That edit could not be saved')
        return false
      }
    },
    [messages]
  )

  const remove = React.useCallback(
    async (messageId: string) => {
      const previous = messages
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? { ...message, deleted: true, body: null, attachments: [], reactions: [] }
            : message
        )
      )
      try {
        await apiDelete(`/api/messaging/messages/${messageId}`)
      } catch (err) {
        setMessages(previous)
        toast.error(err instanceof ApiClientError ? err.message : 'That message could not be deleted')
      }
    },
    [messages]
  )

  const react = React.useCallback(
    async (messageId: string, emoji: string, on: boolean) => {
      const previous = messages
      // Optimistic, because a reaction that waits for a round trip feels
      // broken — it is the one interaction people expect to be instant.
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId ? applyReaction(message, emoji, on) : message
        )
      )
      try {
        if (on) {
          await apiPost(`/api/messaging/messages/${messageId}/reactions`, { emoji })
        } else {
          await apiDelete(`/api/messaging/messages/${messageId}/reactions`, { emoji })
        }
      } catch (err) {
        setMessages(previous)
        if (err instanceof ApiClientError && err.status !== 0) toast.error(err.message)
      }
    },
    [messages]
  )

  const pin = React.useCallback(
    async (messageId: string, pinned: boolean) => {
      try {
        await apiPost(`/api/messaging/messages/${messageId}/pin`, { pinned })
        setMessages((current) =>
          current.map((message) => (message.id === messageId ? { ...message, pinned } : message))
        )
        setDetail((current) => ({
          ...current,
          pinned: pinned
            ? [...current.pinned, ...messages.filter((message) => message.id === messageId)]
            : current.pinned.filter((message) => message.id !== messageId),
        }))
        toast.success(pinned ? 'Pinned to this conversation' : 'Unpinned')
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : 'That could not be pinned')
      }
    },
    [messages]
  )

  return {
    detail,
    messages,
    members,
    typing,
    hasMore,
    loadingMore,
    send,
    retry,
    discard,
    loadOlder,
    edit,
    remove,
    react,
    pin,
    announceTyping,
    refresh,
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function newToken(): string {
  // `randomUUID` is unavailable on an insecure origin, which a self-hosted
  // deployment on plain HTTP genuinely is. The fallback only has to be unique
  // per sender per conversation, which the unique index scopes it to anyway.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function lastConfirmedAt(messages: MessageView[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!messages[index].status) return messages[index].createdAt
  }
  return null
}

/**
 * Fold server truth into local state.
 *
 * Three cases, in this order:
 *
 *   1. SAME ID — replace. The server's copy wins; it has the reactions.
 *   2. SAME CLIENT TOKEN — replace the optimistic bubble with the real row.
 *      This is what stops a message appearing twice: once as the bubble we
 *      drew and once as the echo of our own insert.
 *   3. NEITHER — append, then sort.
 *
 * Sorted by `createdAt` with the id as a tiebreak, matching the server's own
 * ordering, so two messages written in the same millisecond cannot swap places
 * between a realtime append and the next full read.
 */
export function mergeMessages(current: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map(current.map((message) => [message.id, message]))
  const byToken = new Map(
    current.filter((message) => message.clientToken).map((message) => [message.clientToken!, message])
  )

  for (const message of incoming) {
    const displaced = byId.get(message.id) ?? (message.clientToken ? byToken.get(message.clientToken) : undefined)
    if (displaced) byId.delete(displaced.id)
    byId.set(message.id, message)
  }

  return Array.from(byId.values()).sort((a, b) => {
    const order = a.createdAt.localeCompare(b.createdAt)
    return order !== 0 ? order : a.id.localeCompare(b.id)
  })
}

/** Add or remove the caller's own reaction, locally. */
function applyReaction(message: MessageView, emoji: string, on: boolean): MessageView {
  const existing = message.reactions.find((reaction) => reaction.emoji === emoji)

  if (on) {
    if (existing?.mine) return message
    const reactions = existing
      ? message.reactions.map((reaction) =>
          reaction.emoji === emoji
            ? { ...reaction, count: reaction.count + 1, mine: true, names: ['You', ...reaction.names] }
            : reaction
        )
      : [...message.reactions, { emoji, count: 1, mine: true, names: ['You'] }]
    return { ...message, reactions }
  }

  if (!existing?.mine) return message
  const reactions = message.reactions
    .map((reaction) =>
      reaction.emoji === emoji
        ? {
            ...reaction,
            count: reaction.count - 1,
            mine: false,
            names: reaction.names.filter((name) => name !== 'You'),
          }
        : reaction
    )
    .filter((reaction) => reaction.count > 0)
  return { ...message, reactions }
}
