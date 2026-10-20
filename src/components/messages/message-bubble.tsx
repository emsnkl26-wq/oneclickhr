'use client'

import * as React from 'react'
import {
  AlertCircle, Check, CheckCheck, Clock, MoreVertical, Pencil, Pin, PinOff,
  Reply, SmilePlus, Trash2, X,
} from 'lucide-react'
import {
  Avatar, AvatarFallback, AvatarImage,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { REACTION_EMOJI } from '@/lib/schemas'
import {
  continuesGroup, messageFullTime, messageTime, REACTION_NAMES_SHOWN,
  type MessageView,
} from '@/lib/messaging-shared'
import { cn, initials } from '@/lib/utils'
import { MessageText } from '@/components/messages/message-text'
import { Attachments } from '@/components/messages/attachments'

export interface BubbleActions {
  onReply: (message: MessageView) => void
  onReact: (messageId: string, emoji: string, on: boolean) => void
  onEdit: (messageId: string, body: string) => Promise<boolean>
  onDelete: (messageId: string) => void
  onPin: (messageId: string, pinned: boolean) => void
  onRetry: (localId: string) => void
  onDiscard: (localId: string) => void
  /** Scroll to and flash the quoted message. */
  onJumpTo: (messageId: string) => void
}

/**
 * One message.
 *
 * MINE ON THE RIGHT, THEIRS ON THE LEFT, and in a group the sender's name and
 * face on the left column only. That asymmetry is not decoration: the single
 * most common question while scrolling a thread is "who said this", and in a
 * one-to-one conversation the side answers it with no ink at all, which is why
 * a DM shows no names.
 *
 * CONSECUTIVE MESSAGES FROM ONE PERSON ARE GROUPED (`continuesGroup`), so a
 * rapid exchange reads as speech rather than as a column of repeated headshots.
 * The avatar slot is kept, empty, on a continuation — removing it would shift
 * every line in the group a pixel left of the one above.
 *
 * ACTIONS APPEAR ON HOVER AND ON FOCUS. Focus matters as much as hover here:
 * the row is reachable by keyboard and a control that only exists under a
 * pointer is a control a keyboard user does not have.
 */
export function MessageBubble({
  message,
  previous,
  showSender,
  viewerId,
  people,
  canPost,
  canManage,
  readByCount,
  memberCount,
  actions,
  highlighted,
}: {
  message: MessageView
  previous: MessageView | undefined
  /** False in a direct conversation, where the side already says who. */
  showSender: boolean
  viewerId: string
  people: Array<{ id: string; name: string }>
  canPost: boolean
  canManage: boolean
  /** How many OTHER members have read this. Drives the receipt ticks. */
  readByCount: number
  memberCount: number
  actions: BubbleActions
  highlighted: boolean
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(message.body ?? '')
  const [saving, setSaving] = React.useState(false)

  if (message.kind === 'system') {
    return (
      <li className="flex justify-center px-2 py-1">
        <span className="rounded-full bg-page px-3 py-1 text-center text-[11px] text-ink-muted">
          {message.body}
        </span>
      </li>
    )
  }

  const grouped = continuesGroup(message, previous) && !highlighted
  const mine = message.mine
  const failed = message.status === 'failed'

  async function saveEdit() {
    const next = draft.trim()
    if (!next || next === message.body) {
      setEditing(false)
      return
    }
    setSaving(true)
    const ok = await actions.onEdit(message.id, next)
    setSaving(false)
    if (ok) setEditing(false)
  }

  return (
    <li
      id={`message-${message.id}`}
      className={cn(
        'group/message flex gap-2 px-2 transition-colors sm:px-3',
        grouped ? 'mt-0.5' : 'mt-3',
        mine ? 'flex-row-reverse' : 'flex-row',
        highlighted && 'rounded-xl bg-brand-50/70 py-1 dark:bg-brand-500/10'
      )}
    >
      {/* The avatar slot survives a continuation, empty, so the group's lines
          stay aligned with each other. */}
      <div className="w-8 shrink-0">
        {!mine && !grouped ? (
          <Avatar className="size-8">
            {message.senderPhotoUrl ? <AvatarImage src={message.senderPhotoUrl} alt="" /> : null}
            <AvatarFallback className="bg-brand-600 text-[11px] text-white">
              {initials(message.senderName, null)}
            </AvatarFallback>
          </Avatar>
        ) : null}
      </div>

      <div className={cn('flex min-w-0 max-w-[min(42rem,78%)] flex-col', mine && 'items-end')}>
        {showSender && !mine && !grouped ? (
          <p className="mb-0.5 px-1 text-[11px] font-semibold text-ink-muted">
            {message.senderName}
          </p>
        ) : null}

        <div className={cn('flex items-end gap-1', mine && 'flex-row-reverse')}>
          <div
            className={cn(
              'min-w-0 rounded-2xl px-3 py-2 text-sm shadow-sm',
              mine
                ? 'bg-brand-600 text-white'
                : 'bg-card text-ink ring-1 ring-inset ring-line',
              // A retracted message is quieter than the thread around it: its
              // whole content is the fact that there is none.
              message.deleted && 'bg-page text-ink-muted ring-line dark:bg-page',
              failed && 'ring-2 ring-danger'
            )}
          >
            {message.replyTo ? (
              <button
                type="button"
                onClick={() => actions.onJumpTo(message.replyTo!.id)}
                className={cn(
                  'focus-ring mb-1.5 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-[12px]',
                  mine
                    ? 'border-white/60 bg-white/15 text-white/90'
                    : 'border-brand-600 bg-page text-ink-muted'
                )}
              >
                <span className="block font-semibold">{message.replyTo.senderName}</span>
                <span className="line-clamp-2 block">
                  {message.replyTo.deleted
                    ? 'Message deleted'
                    : message.replyTo.body || quotedPlaceholder(message.replyTo.kind)}
                </span>
              </button>
            ) : null}

            {message.deleted ? (
              <p className="italic">This message was deleted</p>
            ) : editing ? (
              <div className="w-[min(28rem,70vw)] space-y-2">
                <Textarea
                  autoFocus
                  rows={3}
                  value={draft}
                  maxLength={8000}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setEditing(false)
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void saveEdit()
                    }
                  }}
                  className="bg-card text-ink"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    <X />
                    Cancel
                  </Button>
                  <Button size="sm" loading={saving} onClick={saveEdit}>
                    <Check />
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <MessageText body={message.body} people={people} viewerId={viewerId} />
                {message.attachments.length ? (
                  <div className={cn(message.body && 'mt-2')}>
                    <Attachments attachments={message.attachments} mine={mine} />
                  </div>
                ) : null}
              </>
            )}

            <p
              className={cn(
                'mt-1 flex items-center justify-end gap-1 text-[10px] leading-none',
                mine ? 'text-white/70' : 'text-ink-muted'
              )}
            >
              {message.pinned ? <Pin className="size-3" aria-label="Pinned" /> : null}
              {message.editedAt ? <span>edited</span> : null}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>{messageTime(message.createdAt)}</span>
                </TooltipTrigger>
                <TooltipContent side="top">{messageFullTime(message.createdAt)}</TooltipContent>
              </Tooltip>
              {mine ? (
                <Receipt
                  status={message.status}
                  readByCount={readByCount}
                  memberCount={memberCount}
                />
              ) : null}
            </p>
          </div>

          {!message.deleted && !editing ? (
            <Actions
              message={message}
              mine={mine}
              canPost={canPost}
              canManage={canManage}
              onStartEdit={() => {
                setDraft(message.body ?? '')
                setEditing(true)
              }}
              actions={actions}
            />
          ) : null}
        </div>

        {message.reactions.length ? (
          <div className={cn('mt-1 flex flex-wrap gap-1', mine && 'justify-end')}>
            {message.reactions.map((reaction) => (
              <Tooltip key={reaction.emoji}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={!canPost}
                    onClick={() => actions.onReact(message.id, reaction.emoji, !reaction.mine)}
                    className={cn(
                      'focus-ring flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                      reaction.mine
                        ? 'border-brand-600 bg-brand-50 text-brand-ink'
                        : 'border-line bg-card text-ink-muted hover:bg-page',
                      !canPost && 'cursor-default opacity-70'
                    )}
                  >
                    <span aria-hidden>{reaction.emoji}</span>
                    <span className="font-medium">{reaction.count}</span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{reactionTooltip(reaction.names, reaction.count)}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        ) : null}

        {failed ? (
          <p className="mt-1 flex items-center gap-2 text-[11px] text-danger">
            <AlertCircle className="size-3" aria-hidden />
            Not sent.
            <button
              type="button"
              onClick={() => actions.onRetry(message.id)}
              className="focus-ring rounded font-semibold underline"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => actions.onDiscard(message.id)}
              className="focus-ring rounded underline"
            >
              Discard
            </button>
          </p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * The delivery ticks on your own message.
 *
 * Three states and no more: in flight, stored, and read by everybody else in
 * the room. A per-person "seen by" list is deliberately absent — in a group of
 * forty it is a popover nobody opens, and the honest summary ("everyone" or
 * not) is the only part anybody acts on.
 *
 * The icons follow the convention every chat tool shares: a clock while the
 * message is still in flight, one tick once it is stored, two ticks — and only
 * these turn colour — once everybody else has read it.
 */
function Receipt({
  status,
  readByCount,
  memberCount,
}: {
  status: MessageView['status']
  readByCount: number
  memberCount: number
}) {
  if (status === 'sending') return <Clock className="size-3" aria-label="Sending" />
  if (status === 'failed') return null
  const others = Math.max(0, memberCount - 1)
  if (others > 0 && readByCount >= others) {
    // The read ticks are the one receipt that changes colour, so "they've seen
    // it" reads at a glance — a light sky blue that holds up on the brand bubble.
    return <CheckCheck className="size-3.5 text-sky-300" aria-label="Read" />
  }
  return <Check className="size-3" aria-label="Sent" />
}

function Actions({
  message,
  mine,
  canPost,
  canManage,
  onStartEdit,
  actions,
}: {
  message: MessageView
  mine: boolean
  canPost: boolean
  canManage: boolean
  onStartEdit: () => void
  actions: BubbleActions
}) {
  // An optimistic bubble has no server id yet, so nothing that addresses a
  // message by id can be offered on it.
  if (message.status) return null

  const canEdit = mine
  const canDelete = mine || canManage
  const canPin = mine || canManage

  return (
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100">
      {canPost ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="focus-ring grid size-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-page hover:text-ink"
            aria-label="React"
          >
            <SmilePlus className="size-[15px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" className="flex w-auto gap-0.5 p-1">
            {REACTION_EMOJI.map((emoji) => {
              const on = message.reactions.some(
                (reaction) => reaction.emoji === emoji && reaction.mine
              )
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => actions.onReact(message.id, emoji, !on)}
                  className={cn(
                    'focus-ring grid size-8 place-items-center rounded-lg text-base transition-colors hover:bg-page',
                    on && 'bg-brand-50'
                  )}
                  aria-label={`React with ${emoji}`}
                  aria-pressed={on}
                >
                  {emoji}
                </button>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {canPost ? (
        <button
          type="button"
          onClick={() => actions.onReply(message)}
          className="focus-ring grid size-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-page hover:text-ink"
          aria-label="Reply"
        >
          <Reply className="size-[15px]" />
        </button>
      ) : null}

      {canEdit || canDelete || canPin ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="focus-ring grid size-7 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-page hover:text-ink"
            aria-label="More"
          >
            <MoreVertical className="size-[15px]" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align={mine ? 'end' : 'start'}>
            {canPin ? (
              <DropdownMenuItem onClick={() => actions.onPin(message.id, !message.pinned)}>
                {message.pinned ? <PinOff /> : <Pin />}
                {message.pinned ? 'Unpin' : 'Pin to conversation'}
              </DropdownMenuItem>
            ) : null}
            {canEdit ? (
              <DropdownMenuItem onClick={onStartEdit}>
                <Pencil />
                Edit
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onClick={() => actions.onDelete(message.id)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  )
}

function quotedPlaceholder(kind: MessageView['kind']): string {
  if (kind === 'image') return 'Photo'
  if (kind === 'voice') return 'Voice message'
  if (kind === 'file') return 'Attachment'
  return 'Message'
}

function reactionTooltip(names: string[], count: number): string {
  const extra = count - names.length
  const shown = names.slice(0, REACTION_NAMES_SHOWN).join(', ')
  return extra > 0 ? `${shown} and ${extra} more` : shown
}
