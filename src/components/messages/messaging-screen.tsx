'use client'

import * as React from 'react'
import { ArrowLeft, Archive, Info, Loader2, MessageSquare, Search, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/primitives'
import { apiGet, apiPost, ApiClientError } from '@/lib/fetcher'
import { useProgressRouter } from '@/lib/use-progress-router'
import {
  messageDateLabel, messageTime,
  type ConversationDetail, type ConversationSummary, type MessageView, type MessagingPerson,
} from '@/lib/messaging-shared'
import { cn } from '@/lib/utils'
import { ConversationList, RoomAvatar } from '@/components/messages/conversation-list'
import { ConversationInfo } from '@/components/messages/conversation-info'
import { Composer } from '@/components/messages/composer'
import { MessageThread } from '@/components/messages/message-thread'
import { NewConversationDialog, type ProjectOption } from '@/components/messages/new-conversation-dialog'
import { useConversation } from '@/components/messages/use-conversation'
import { useConversations } from '@/components/messages/use-conversations'

/**
 * The messaging screen: a list on the left, a thread on the right.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE URL IS THE STATE, AND THE PANES ARE NOT TWO PAGES                   │
 * │                                                                          │
 * │ Which conversation is open lives in the path (`/…/messages/<id>`), so a  │
 * │ thread is linkable, the back button works, and a push notification can    │
 * │ open the room it is about. But opening one does NOT re-render the list:   │
 * │ both panes are one client component, and the list keeps its scroll        │
 * │ position, its filter and its live subscription across every switch.      │
 * │                                                                          │
 * │ The thread's data still comes from the SERVER for the conversation in     │
 * │ the URL — passed in as `detail` — so a cold open renders a full thread    │
 * │ with no loading state, and navigating within the screen fetches just the  │
 * │ thread it needs.                                                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ON A PHONE THE TWO PANES ARE ONE AT A TIME. A 44-character-wide thread beside
 * a 30-character-wide list is neither, so below `lg` the list IS the screen
 * until a conversation is opened, and the thread gets a back button.
 */
export function MessagingScreen({
  basePath,
  initialConversations,
  initialPeople,
  initialDetail,
  projects,
  canCreateProjectRoom,
  viewerId,
  viewerName,
  tenantId,
}: {
  /** `/org/messages` or `/employee/messages`. */
  basePath: string
  initialConversations: ConversationSummary[]
  initialPeople: MessagingPerson[]
  /** The conversation in the URL, already loaded. Null on the index. */
  initialDetail: ConversationDetail | null
  projects: ProjectOption[]
  canCreateProjectRoom: boolean
  viewerId: string
  viewerName: string
  tenantId: string
}) {
  const router = useProgressRouter()
  const list = useConversations({ initialConversations, initialPeople })

  const [detail, setDetail] = React.useState<ConversationDetail | null>(initialDetail)
  const [loadingThread, setLoadingThread] = React.useState(false)
  const [showNew, setShowNew] = React.useState(false)
  const [showInfo, setShowInfo] = React.useState(false)
  const [replyTo, setReplyTo] = React.useState<MessageView | null>(null)
  const [searching, setSearching] = React.useState(false)

  // The server's copy wins on navigation — it is the conversation in the URL.
  React.useEffect(() => {
    setDetail(initialDetail)
    setReplyTo(null)
    setShowInfo(false)
    setSearching(false)
  }, [initialDetail])

  /**
   * Open a conversation.
   *
   * The thread is fetched here AND the URL is pushed, in that order, so the
   * pane fills from the client's own request rather than waiting for the server
   * render — which keeps the list from flashing — while the address still ends
   * up linkable. The server render that follows is the same data and simply
   * replaces it.
   */
  const open = React.useCallback(
    async (conversation: ConversationSummary) => {
      if (conversation.id === detail?.conversation.id) return
      list.markOpened(conversation.id)
      setLoadingThread(true)
      router.push(`${basePath}/${conversation.id}`)
      try {
        const next = await apiGet<ConversationDetail>(
          `/api/messaging/conversations/${conversation.id}`
        )
        setDetail(next)
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : 'That conversation could not be opened')
      } finally {
        setLoadingThread(false)
      }
    },
    [basePath, detail?.conversation.id, list, router]
  )

  const reloadThread = React.useCallback(async () => {
    const id = detail?.conversation.id
    if (!id) return
    try {
      setDetail(await apiGet<ConversationDetail>(`/api/messaging/conversations/${id}`))
    } catch {
      // Leave what is on screen; it was right a moment ago.
    }
    list.refresh()
  }, [detail?.conversation.id, list])

  const leave = React.useCallback(() => {
    toast.success('You left the conversation')
    setDetail(null)
    router.push(basePath)
    list.refresh()
  }, [basePath, list, router])

  const destroyed = React.useCallback(() => {
    toast.success('Conversation deleted')
    setDetail(null)
    router.push(basePath)
    list.refresh()
  }, [basePath, list, router])

  return (
    <TooltipProvider delayDuration={300}>
      <NewConversationDialog
        open={showNew}
        onOpenChange={setShowNew}
        people={list.people.filter((person) => person.id !== viewerId)}
        projects={projects}
        canCreateProjectRoom={canCreateProjectRoom}
        onCreated={(conversationId) => {
          router.push(`${basePath}/${conversationId}`)
          list.refresh()
        }}
      />

      {detail ? (
        <ConversationInfo
          open={showInfo}
          onOpenChange={setShowInfo}
          detail={detail}
          people={list.people}
          viewerId={viewerId}
          muted={
            list.conversations.find((row) => row.id === detail.conversation.id)?.muted ?? false
          }
          onMutedChange={(muted) => void list.setPref(detail.conversation.id, { muted })}
          onChanged={reloadThread}
          onLeft={leave}
          onDeleted={destroyed}
        />
      ) : null}

      {/* A fixed-height shell: the two panes scroll inside it, the page does
          not. A thread that scrolls the whole document loses its composer off
          the bottom of the screen. */}
      <div className="flex h-[calc(100vh-7.5rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-line bg-card shadow-card">
        <ConversationList
          conversations={list.conversations}
          activeId={detail?.conversation.id ?? null}
          onOpen={open}
          onNew={() => setShowNew(true)}
          onSetPref={(id, pref) => void list.setPref(id, pref)}
          className={cn('w-full shrink-0 lg:w-80', detail && 'hidden lg:flex')}
        />

        <div className={cn('min-w-0 flex-1 flex-col', detail ? 'flex' : 'hidden lg:flex')}>
          {detail ? (
            <Thread
              key={detail.conversation.id}
              basePath={basePath}
              detail={detail}
              people={list.people}
              viewerId={viewerId}
              viewerName={viewerName}
              tenantId={tenantId}
              loading={loadingThread}
              replyTo={replyTo}
              onReplyTo={setReplyTo}
              onShowInfo={() => setShowInfo(true)}
              searching={searching}
              onSearchingChange={setSearching}
              onBack={() => {
                setDetail(null)
                router.push(basePath)
              }}
              onListRefresh={list.refresh}
            />
          ) : (
            <NothingOpen onNew={() => setShowNew(true)} />
          )}
        </div>
      </div>
    </TooltipProvider>
  )
}

/**
 * One open conversation.
 *
 * Its own component so that `useConversation` — which owns a websocket
 * subscription, a debounce timer and the optimistic message list — is
 * REMOUNTED when the conversation changes. The `key` on it above is what does
 * that, and it is the simplest correct answer: a hook that tried to swap
 * conversations in place has to tear down and rebuild all three anyway, and
 * would keep the previous room's messages on screen for the instant between.
 */
function Thread({
  basePath,
  detail,
  people,
  viewerId,
  viewerName,
  tenantId,
  loading,
  replyTo,
  onReplyTo,
  onShowInfo,
  searching,
  onSearchingChange,
  onBack,
  onListRefresh,
}: {
  basePath: string
  detail: ConversationDetail
  people: MessagingPerson[]
  viewerId: string
  viewerName: string
  tenantId: string
  loading: boolean
  replyTo: MessageView | null
  onReplyTo: (message: MessageView | null) => void
  onShowInfo: () => void
  searching: boolean
  onSearchingChange: (searching: boolean) => void
  onBack: () => void
  onListRefresh: () => void
}) {
  const conversation = useConversation({ initial: detail, viewerId, viewerName, tenantId })
  const { conversation: room } = conversation.detail

  /*
   * The read mark, throttled.
   *
   * `onReachBottom` fires on every scroll event that lands near the bottom —
   * dozens per flick — and each one would otherwise be a write. Once every few
   * seconds is indistinguishable to the reader and is the difference between
   * one UPDATE and fifty.
   */
  const lastMark = React.useRef(0)
  const markRead = React.useCallback(() => {
    const now = Date.now()
    if (now - lastMark.current < 3000) return
    lastMark.current = now
    void apiPost(`/api/messaging/conversations/${room.id}/read`).then(onListRefresh).catch(() => {
      // A read mark that did not land is re-sent by the next scroll.
    })
  }, [room.id, onListRefresh])

  // The ROOM's roster is what `@` offers and what the server resolves against.
  const roster = React.useMemo(
    () => conversation.members.map((member) => ({ id: member.id, name: member.name })),
    [conversation.members]
  )

  const actions = React.useMemo(
    () => ({
      onReply: onReplyTo,
      onReact: (messageId: string, emoji: string, on: boolean) =>
        void conversation.react(messageId, emoji, on),
      onEdit: conversation.edit,
      onDelete: (messageId: string) => void conversation.remove(messageId),
      onPin: (messageId: string, pinned: boolean) => void conversation.pin(messageId, pinned),
      onRetry: (localId: string) => void conversation.retry(localId),
      onDiscard: conversation.discard,
      onJumpTo: () => {},
    }),
    [conversation, onReplyTo]
  )

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-page hover:text-ink lg:hidden"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="size-[18px]" />
        </button>

        <RoomAvatar conversation={room} />

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold text-ink">
            {room.title}
            {room.archived ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Archive className="size-3.5 shrink-0 text-ink-muted" aria-label="Archived" />
                </TooltipTrigger>
                <TooltipContent>Archived — read-only</TooltipContent>
              </Tooltip>
            ) : null}
          </p>
          <p className="truncate text-[11px] text-ink-muted">
            {conversation.typing.length
              ? 'typing…'
              : room.kind === 'direct'
                ? room.subtitle
                : `${room.memberCount} ${room.memberCount === 1 ? 'member' : 'members'}${
                    room.posting === 'admins' ? ' · administrators post' : ''
                  }`}
          </p>
        </div>

        {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" aria-hidden /> : null}

        <button
          type="button"
          onClick={() => onSearchingChange(!searching)}
          className="focus-ring grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-page hover:text-ink"
          aria-label="Search in this conversation"
          aria-pressed={searching}
        >
          {searching ? <X className="size-[18px]" /> : <Search className="size-[18px]" />}
        </button>
        <button
          type="button"
          onClick={onShowInfo}
          className="focus-ring grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-page hover:text-ink"
          aria-label={room.kind === 'direct' ? 'Conversation details' : 'Members and settings'}
        >
          {room.kind === 'direct' ? <Info className="size-[18px]" /> : <Users className="size-[18px]" />}
        </button>
      </header>

      {searching ? <SearchPanel conversationId={room.id} /> : null}

      <MessageThread
        detail={conversation.detail}
        messages={conversation.messages}
        viewerId={viewerId}
        people={roster}
        typingNames={conversation.typing.map((person) => person.name)}
        hasMore={conversation.hasMore}
        loadingMore={conversation.loadingMore}
        onLoadOlder={() => void conversation.loadOlder()}
        onReachBottom={markRead}
        actions={actions}
      />

      {!room.observerOnly ? (
        <Composer
          conversationId={room.id}
          people={conversation.members}
          replyTo={replyTo}
          onCancelReply={() => onReplyTo(null)}
          canPost={conversation.detail.canPost}
          disabledReason={
            room.archived
              ? 'This conversation is archived. An administrator can reopen it.'
              : room.posting === 'admins'
                ? 'Only administrators can post here.'
                : undefined
          }
          onSend={conversation.send}
          onTyping={conversation.announceTyping}
        />
      ) : null}
    </>
  )
}

/**
 * Search inside this conversation.
 *
 * Goes to the server (`/api/messaging/search`) rather than filtering what is on
 * screen, because what is on screen is the last forty messages and the point of
 * searching is the eleven months above them. Debounced, and the endpoint is
 * rate limited behind it — a debounce is a courtesy, not a control.
 */
function SearchPanel({ conversationId }: { conversationId: string }) {
  const [term, setTerm] = React.useState('')
  const [results, setResults] = React.useState<MessageView[] | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    const needle = term.trim()
    if (needle.length < 2) {
      setResults(null)
      return
    }
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const found = await apiGet<{ messages: MessageView[] }>(
          `/api/messaging/search?q=${encodeURIComponent(needle)}&conversationId=${conversationId}`
        )
        setResults(found.messages)
      } catch {
        setResults([])
      } finally {
        setBusy(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [term, conversationId])

  return (
    <div className="shrink-0 border-b border-line bg-page px-3 py-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          aria-hidden
        />
        <Input
          autoFocus
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search in this conversation"
          aria-label="Search in this conversation"
          className="h-9 pl-9"
        />
      </div>

      {busy ? <p className="pt-2 text-[12px] text-ink-muted">Searching…</p> : null}

      {results ? (
        results.length ? (
          <ul className="scrollbar-thin mt-2 max-h-48 space-y-1 overflow-y-auto">
            {results.map((message) => (
              <li key={message.id}>
                <a
                  href={`#message-${message.id}`}
                  className="focus-ring block rounded-lg px-2 py-1.5 transition-colors hover:bg-card"
                >
                  <span className="flex items-baseline gap-2 text-[11px] text-ink-muted">
                    <span className="font-semibold text-ink">{message.senderName}</span>
                    {messageDateLabel(message.createdAt)} · {messageTime(message.createdAt)}
                  </span>
                  <span className="line-clamp-2 block text-[12px] text-ink">
                    {message.body || 'Attachment'}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pt-2 text-[12px] text-ink-muted">Nothing matched.</p>
        )
      ) : null}
    </div>
  )
}

function NothingOpen({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-page text-ink-muted">
        <MessageSquare className="size-7" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-ink">Pick a conversation</p>
        <p className="max-w-xs text-[13px] leading-relaxed text-ink-muted">
          Message a colleague, start a group for a team, or open a room for a project — everything
          stays inside this workspace.
        </p>
      </div>
      <Button onClick={onNew}>New conversation</Button>
    </div>
  )
}
