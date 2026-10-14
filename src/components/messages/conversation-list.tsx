'use client'

import * as React from 'react'
import {
  Archive, BellOff, Briefcase, MessageSquarePlus, Pin, PinOff, Search, Users, X,
} from 'lucide-react'
import {
  Avatar, AvatarFallback, AvatarImage,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/primitives'
import { Input } from '@/components/ui/input'
import { conversationTime, type ConversationSummary } from '@/lib/messaging-shared'
import { cn, initials } from '@/lib/utils'

/**
 * The left pane: every conversation, pinned first, newest next.
 *
 * FILTERED IN THE BROWSER, deliberately, and this is the one screen in the
 * product where that is the right call. The whole list is already here — it is
 * one row per conversation a person is in, which is tens, not thousands — so a
 * server round trip per keystroke would buy nothing but latency. Searching
 * inside the MESSAGES is a different question with a different answer: that is
 * `/api/messaging/search`, against a GIN index, because the history is large.
 *
 * The unread pill is the only place in this component that uses the brand
 * colour, so it is the first thing the eye finds — which is the entire job of
 * a conversation list.
 */
export function ConversationList({
  conversations,
  activeId,
  onOpen,
  onNew,
  onSetPref,
  className,
}: {
  conversations: ConversationSummary[]
  activeId: string | null
  onOpen: (conversation: ConversationSummary) => void
  onNew: () => void
  onSetPref: (conversationId: string, pref: { muted?: boolean; pinned?: boolean }) => void
  className?: string
}) {
  const [term, setTerm] = React.useState('')
  const [showArchived, setShowArchived] = React.useState(false)

  const filtered = React.useMemo(() => {
    const needle = term.trim().toLowerCase()
    return conversations.filter((conversation) => {
      if (conversation.archived && !showArchived) return false
      if (!needle) return true
      return (
        conversation.title.toLowerCase().includes(needle) ||
        (conversation.subtitle ?? '').toLowerCase().includes(needle) ||
        (conversation.lastMessageText ?? '').toLowerCase().includes(needle)
      )
    })
  }, [conversations, term, showArchived])

  const archivedCount = conversations.filter((conversation) => conversation.archived).length

  return (
    <div className={cn('flex min-h-0 flex-col border-r border-line bg-card', className)}>
      <div className="shrink-0 space-y-2 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold text-ink">Messages</h2>
          <button
            type="button"
            onClick={onNew}
            className="focus-ring grid size-8 place-items-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700"
            aria-label="New conversation"
          >
            <MessageSquarePlus className="size-[17px]" />
          </button>
        </div>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search conversations"
            aria-label="Search conversations"
            className="h-9 pl-9 pr-8"
          />
          {term ? (
            <button
              type="button"
              onClick={() => setTerm('')}
              className="focus-ring absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-ink-muted hover:text-ink"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <ul className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.map((conversation) => (
          <li key={conversation.id}>
            <Row
              conversation={conversation}
              active={conversation.id === activeId}
              onOpen={() => onOpen(conversation)}
              onSetPref={(pref) => onSetPref(conversation.id, pref)}
            />
          </li>
        ))}

        {!filtered.length ? (
          <li className="px-3 py-10 text-center text-[13px] text-ink-muted">
            {term ? 'No conversation matches that.' : 'No conversations yet.'}
          </li>
        ) : null}
      </ul>

      {archivedCount ? (
        <button
          type="button"
          onClick={() => setShowArchived((current) => !current)}
          className="focus-ring flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5 text-[12px] text-ink-muted transition-colors hover:text-ink"
        >
          <Archive className="size-3.5" aria-hidden />
          {showArchived ? 'Hide archived' : `${archivedCount} archived`}
        </button>
      ) : null}
    </div>
  )
}

function Row({
  conversation,
  active,
  onOpen,
  onSetPref,
}: {
  conversation: ConversationSummary
  active: boolean
  onOpen: () => void
  onSetPref: (pref: { muted?: boolean; pinned?: boolean }) => void
}) {
  const unread = conversation.unread > 0

  return (
    <div
      className={cn(
        'group/row relative flex items-center gap-2 rounded-xl px-2 transition-colors',
        active ? 'bg-brand-50 dark:bg-brand-500/15' : 'hover:bg-page'
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className="focus-ring flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-2 text-left"
      >
        <RoomAvatar conversation={conversation} />

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px]',
                unread ? 'font-semibold text-ink' : 'font-medium text-ink'
              )}
            >
              {conversation.title}
            </span>
            <span className="shrink-0 text-[10px] tabular-nums text-ink-muted">
              {conversationTime(conversation.lastMessageAt)}
            </span>
          </span>

          <span className="mt-0.5 flex items-center gap-1.5">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[12px]',
                unread ? 'text-ink' : 'text-ink-muted'
              )}
            >
              {previewLine(conversation)}
            </span>
            {conversation.muted ? (
              <BellOff className="size-3 shrink-0 text-ink-muted" aria-label="Muted" />
            ) : null}
            {conversation.pinned ? (
              <Pin className="size-3 shrink-0 text-ink-muted" aria-label="Pinned" />
            ) : null}
            {unread ? (
              <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-none text-white">
                {conversation.unread > 99 ? '99+' : conversation.unread}
              </span>
            ) : null}
          </span>
        </span>
      </button>

      {/* Per-reader settings. Hidden until the row is hovered or focused, so a
          list of thirty conversations is not a list of sixty buttons. */}
      {!conversation.observerOnly ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="focus-ring grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted opacity-0 transition-opacity hover:bg-card focus:opacity-100 group-hover/row:opacity-100"
            aria-label={`Options for ${conversation.title}`}
          >
            <span className="text-base leading-none">⋯</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onSetPref({ pinned: !conversation.pinned })}>
              {conversation.pinned ? <PinOff /> : <Pin />}
              {conversation.pinned ? 'Unpin' : 'Pin to top'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSetPref({ muted: !conversation.muted })}>
              <BellOff />
              {conversation.muted ? 'Unmute notifications' : 'Mute notifications'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

/**
 * The 36px slot. A direct message wears the other person's face; a room wears
 * its own picture, or an icon tinted with the colour it was given — which is
 * what makes two similarly named groups tellable apart at a glance.
 */
export function RoomAvatar({
  conversation,
  size = 'md',
}: {
  conversation: ConversationSummary
  size?: 'md' | 'lg'
}) {
  const dimension = size === 'lg' ? 'size-10' : 'size-9'

  if (conversation.kind === 'direct' || conversation.avatarUrl) {
    return (
      <Avatar className={cn(dimension, 'shrink-0')}>
        {conversation.avatarUrl ? <AvatarImage src={conversation.avatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-brand-600 text-[11px] text-white">
          {initials(conversation.title, null)}
        </AvatarFallback>
      </Avatar>
    )
  }

  const Icon = conversation.kind === 'project' ? Briefcase : Users
  return (
    <span
      className={cn(dimension, 'grid shrink-0 place-items-center rounded-full')}
      style={{ backgroundColor: `${conversation.color}1f`, color: conversation.color }}
      aria-hidden
    >
      <Icon className={size === 'lg' ? 'size-5' : 'size-4'} />
    </span>
  )
}

function previewLine(conversation: ConversationSummary): string {
  if (conversation.observerOnly) {
    return conversation.subtitle ?? 'You are not in this conversation'
  }
  if (!conversation.lastMessageText) return conversation.subtitle ?? 'No messages yet'
  // In a group, who said it matters as much as what; in a DM there is only one
  // other person it could have been.
  if (conversation.kind !== 'direct' && conversation.lastMessageKind !== 'system' && conversation.lastMessageBy) {
    return `${conversation.lastMessageBy}: ${conversation.lastMessageText}`
  }
  return conversation.lastMessageText
}
