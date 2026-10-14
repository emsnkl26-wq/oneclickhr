'use client'

import * as React from 'react'
import { ArrowDown, Loader2, MessageSquare, Pin } from 'lucide-react'
import { messageDateLabel, type MessageView, type ConversationDetail } from '@/lib/messaging-shared'
import { cn } from '@/lib/utils'
import { MessageBubble, type BubbleActions } from '@/components/messages/message-bubble'

/**
 * The scrolling list of messages.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THREE SCROLL BEHAVIOURS, AND WHY EACH ONE IS NOT THE OTHER TWO           │
 * │                                                                          │
 * │ 1. OPENING a conversation jumps to the bottom with no animation. A       │
 * │    smooth scroll through three hundred messages is a second of           │
 * │    flickering nobody asked for.                                          │
 * │                                                                          │
 * │ 2. A NEW MESSAGE scrolls down ONLY if the reader was already near the    │
 * │    bottom. Yanking somebody out of the history they are reading because  │
 * │    a colleague said "ok" is the single rudest thing a chat UI can do, so  │
 * │    when they are scrolled up the arrival becomes the pill at the bottom   │
 * │    instead.                                                              │
 * │                                                                          │
 * │ 3. PAGING OLDER messages must not move the view at all. The browser's     │
 * │    scroll offset is measured from the TOP, so prepending content shifts  │
 * │    everything the reader is looking at downwards; the fix is to restore   │
 * │    the distance from the BOTTOM, which is the thing that stayed still.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * READ MARKS are sent when the bottom is reached, not when the component
 * mounts: a conversation opened in a background tab has not been read, and
 * marking it so is how an unread badge silently loses a message.
 */

/** How close to the bottom still counts as "following the conversation". */
const NEAR_BOTTOM_PX = 120
/** How far from the top a scroll triggers the next page. */
const LOAD_MORE_PX = 200

export function MessageThread({
  detail,
  messages,
  viewerId,
  people,
  typingNames,
  hasMore,
  loadingMore,
  onLoadOlder,
  onReachBottom,
  actions,
}: {
  detail: ConversationDetail
  messages: MessageView[]
  viewerId: string
  people: Array<{ id: string; name: string }>
  typingNames: string[]
  hasMore: boolean
  loadingMore: boolean
  onLoadOlder: () => void
  onReachBottom: () => void
  actions: BubbleActions
}) {
  const scroller = React.useRef<HTMLDivElement | null>(null)
  const [atBottom, setAtBottom] = React.useState(true)
  const [unseen, setUnseen] = React.useState(0)
  const [flash, setFlash] = React.useState<string | null>(null)

  const conversationId = detail.conversation.id
  const showSender = detail.conversation.kind !== 'direct'

  /*
   * How many members have read up to a given message. Computed once per render
   * over the roster rather than per bubble: a forty-person room would otherwise
   * be forty comparisons times forty bubbles on every keystroke elsewhere in
   * the page.
   */
  const readStamps = React.useMemo(
    () =>
      detail.members
        .filter((member) => member.id !== viewerId)
        .map((member) => member.lastReadAt)
        .filter((stamp): stamp is string => !!stamp)
        .sort(),
    [detail.members, viewerId]
  )

  const readCountFor = React.useCallback(
    (createdAt: string) => readStamps.filter((stamp) => stamp >= createdAt).length,
    [readStamps]
  )

  const jumpToBottom = React.useCallback((smooth = false) => {
    const element = scroller.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // (1) Opening, or switching conversations.
  React.useEffect(() => {
    jumpToBottom(false)
    setAtBottom(true)
    setUnseen(0)
  }, [conversationId, jumpToBottom])

  /*
   * (2) and (3). One effect, because both react to the same thing — the list
   * growing — and they differ only in WHICH end it grew at.
   */
  const previousCount = React.useRef(messages.length)
  const previousOldest = React.useRef(messages[0]?.id)
  const bottomGap = React.useRef(0)

  React.useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return

    const grewAtTop = messages[0]?.id !== previousOldest.current && messages.length > previousCount.current
    previousOldest.current = messages[0]?.id

    if (grewAtTop) {
      // Restore the distance from the bottom, which is what did not move.
      element.scrollTop = element.scrollHeight - bottomGap.current
    } else if (messages.length > previousCount.current) {
      if (atBottom) jumpToBottom(false)
      else setUnseen((count) => count + (messages.length - previousCount.current))
    }

    previousCount.current = messages.length
  }, [messages, atBottom, jumpToBottom])

  function onScroll() {
    const element = scroller.current
    if (!element) return
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    bottomGap.current = element.scrollHeight - element.scrollTop

    const near = distanceFromBottom < NEAR_BOTTOM_PX
    setAtBottom(near)
    if (near) {
      setUnseen(0)
      onReachBottom()
    }
    if (element.scrollTop < LOAD_MORE_PX && hasMore && !loadingMore) onLoadOlder()
  }

  /*
   * The bottom is reached on open too — but only once the thread is actually on
   * screen, which `requestAnimationFrame` after the scroll guarantees. A read
   * mark fired before layout would be reporting on a conversation nobody has
   * seen a line of yet.
   */
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = scroller.current
      if (!element) return
      const distance = element.scrollHeight - element.scrollTop - element.clientHeight
      if (distance < NEAR_BOTTOM_PX) onReachBottom()
    })
    return () => cancelAnimationFrame(frame)
  }, [conversationId, onReachBottom])

  /** Scroll to a quoted message and flash it, so the jump is visible. */
  const jumpTo = React.useCallback((messageId: string) => {
    const target = document.getElementById(`message-${messageId}`)
    if (!target) {
      // It is above the loaded window. Paging up to find it is a bigger
      // promise than this is worth; the reader scrolls.
      return
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(messageId)
    window.setTimeout(() => setFlash((current) => (current === messageId ? null : current)), 1600)
  }, [])

  const bubbleActions = React.useMemo<BubbleActions>(
    () => ({ ...actions, onJumpTo: jumpTo }),
    [actions, jumpTo]
  )

  if (detail.conversation.observerOnly) {
    return <ObserverNotice name={detail.conversation.title} />
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {detail.pinned.length ? (
        <PinnedStrip pinned={detail.pinned} onJumpTo={jumpTo} />
      ) : null}

      <div
        ref={scroller}
        onScroll={onScroll}
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain py-2"
      >
        {loadingMore ? (
          <p className="flex items-center justify-center gap-2 py-3 text-[12px] text-ink-muted">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Loading earlier messages
          </p>
        ) : null}

        {!hasMore && messages.length ? (
          <p className="px-4 py-3 text-center text-[11px] text-ink-muted">
            This is the beginning of the conversation.
          </p>
        ) : null}

        {!messages.length ? <EmptyThread kind={detail.conversation.kind} /> : null}

        <ol>
          {messages.map((message, index) => {
            const previous = messages[index - 1]
            const dayChanged =
              !previous ||
              messageDateLabel(previous.createdAt) !== messageDateLabel(message.createdAt)
            return (
              <React.Fragment key={message.id}>
                {dayChanged ? (
                  <li className="sticky top-0 z-10 flex justify-center py-2">
                    <span className="rounded-full border border-line bg-card/90 px-2.5 py-0.5 text-[11px] font-medium text-ink-muted backdrop-blur">
                      {messageDateLabel(message.createdAt)}
                    </span>
                  </li>
                ) : null}
                <MessageBubble
                  message={message}
                  previous={dayChanged ? undefined : previous}
                  showSender={showSender}
                  viewerId={viewerId}
                  people={people}
                  canPost={detail.canPost}
                  canManage={detail.canManage}
                  readByCount={readCountFor(message.createdAt)}
                  memberCount={detail.conversation.memberCount}
                  actions={bubbleActions}
                  highlighted={flash === message.id}
                />
              </React.Fragment>
            )
          })}
        </ol>

        {typingNames.length ? (
          <p className="px-4 py-2 text-[12px] italic text-ink-muted" aria-live="polite">
            {typingLine(typingNames)}
          </p>
        ) : null}
      </div>

      {!atBottom ? (
        <button
          type="button"
          onClick={() => {
            jumpToBottom(true)
            setUnseen(0)
          }}
          className={cn(
            'focus-ring absolute bottom-3 right-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium shadow-pop transition-colors',
            unseen > 0
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'border border-line bg-card text-ink-muted hover:text-ink'
          )}
        >
          <ArrowDown className="size-3.5" aria-hidden />
          {unseen > 0 ? `${unseen} new` : 'Latest'}
        </button>
      ) : null}
    </div>
  )
}

/** The pinned messages, as a strip the whole room shares. */
function PinnedStrip({
  pinned,
  onJumpTo,
}: {
  pinned: MessageView[]
  onJumpTo: (messageId: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const shown = open ? pinned : pinned.slice(0, 1)

  return (
    <div className="shrink-0 border-b border-line bg-brand-50/60 px-4 py-2 dark:bg-brand-500/10">
      <ul className="space-y-1">
        {shown.map((message) => (
          <li key={message.id}>
            <button
              type="button"
              onClick={() => onJumpTo(message.id)}
              className="focus-ring flex w-full items-start gap-2 rounded-lg px-1 py-0.5 text-left"
            >
              <Pin className="mt-0.5 size-3 shrink-0 text-brand-ink" aria-hidden />
              <span className="min-w-0 flex-1 text-[12px] text-ink">
                <span className="font-semibold">{message.senderName}: </span>
                <span className="text-ink-muted">{message.body || 'Attachment'}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {pinned.length > 1 ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="focus-ring mt-1 rounded text-[11px] font-medium text-brand-ink"
        >
          {open ? 'Show less' : `${pinned.length - 1} more pinned`}
        </button>
      ) : null}
    </div>
  )
}

/**
 * What an administrator sees in a room they manage but are not in.
 *
 * Stated plainly, because the alternative is somebody concluding the feature is
 * broken — and because it is worth their knowing that joining is possible and
 * that the room will see them do it.
 */
function ObserverNotice({ name }: { name: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-page text-ink-muted">
        <MessageSquare className="size-6" aria-hidden />
      </span>
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-semibold text-ink">You are not in {name}</p>
        <p className="text-[13px] leading-relaxed text-ink-muted">
          As a workspace administrator you can rename this conversation, change who is in it, archive
          it or delete it — but you cannot read it. Add yourself from the members panel to join; the
          conversation records that you did.
        </p>
      </div>
    </div>
  )
}

function EmptyThread({ kind }: { kind: ConversationDetail['conversation']['kind'] }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-2xl bg-page text-ink-muted">
        <MessageSquare className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-ink">
        {kind === 'direct' ? 'Say hello' : 'Nothing here yet'}
      </p>
      <p className="max-w-xs text-[13px] text-ink-muted">
        {kind === 'direct'
          ? 'Messages here are between the two of you.'
          : 'Send the first message to get this conversation started.'}
      </p>
    </div>
  )
}

function typingLine(names: string[]): string {
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return 'Several people are typing…'
}
