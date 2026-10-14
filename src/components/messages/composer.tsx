'use client'

import * as React from 'react'
import { Loader2, Paperclip, Send, Smile, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Avatar, AvatarFallback, AvatarImage,
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
} from '@/components/ui/primitives'
import { uploadFile, ApiClientError } from '@/lib/fetcher'
import { MAX_MESSAGE_ATTACHMENTS, REACTION_EMOJI } from '@/lib/schemas'
import { formatSize, type MessageView, type MessagingPerson } from '@/lib/messaging-shared'
import { cn, initials } from '@/lib/utils'
import { VoiceRecorder, type Recording } from '@/components/messages/voice-recorder'
import type { OutgoingFile } from '@/components/messages/use-conversation'
import { TYPING_PING_MS } from '@/components/messages/use-conversation'

/**
 * The box at the bottom of a thread.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FILES ARE UPLOADED WHEN THEY ARE PICKED, NOT WHEN SEND IS PRESSED       │
 * │                                                                          │
 * │ A 10MB photo takes seconds to reach storage. Doing it on Send means the  │
 * │ button sits spinning for those seconds with the typed message still in    │
 * │ the box, and if the upload fails the person has a message they cannot      │
 * │ send and no idea which part broke.                                       │
 * │                                                                          │
 * │ Uploading on PICK makes the wait concurrent with typing the caption,      │
 * │ gives each attachment its own progress and its own failure, and makes     │
 * │ Send what it should be: one small JSON POST carrying keys that already    │
 * │ exist and have already been inspected by /api/files/finalize.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ENTER SENDS, SHIFT+ENTER IS A NEWLINE — the convention every workplace chat
 * shares, and getting it backwards is the single most noticeable way to get a
 * composer wrong. On a touch screen Enter inserts a newline instead, because
 * there is no Shift to hold and the on-screen keyboard's own Send button is
 * the one that submits.
 *
 * MENTIONS are an inline autocomplete rather than a picker: typing `@pr` filters
 * the room's roster, Enter or Tab inserts the full name, and the SERVER re-parses
 * the finished text against the same roster with the same function
 * (`findMentions`). Nothing about who was mentioned is taken from this component
 * — it only helps somebody type a name correctly.
 */

interface Pending {
  localId: string
  name: string
  sizeBytes: number
  /** Set once the upload lands. Until then this row is a spinner. */
  uploaded?: OutgoingFile
  failed?: boolean
  voice?: boolean
}

export function Composer({
  conversationId,
  people,
  replyTo,
  onCancelReply,
  canPost,
  disabledReason,
  onSend,
  onTyping,
}: {
  conversationId: string
  /** The ROOM's roster — what `@` offers, and what the server will resolve against. */
  people: MessagingPerson[]
  replyTo: MessageView | null
  onCancelReply: () => void
  canPost: boolean
  /** Why not, when `canPost` is false. Shown in place of the box. */
  disabledReason?: string
  onSend: (input: {
    body: string | null
    replyToId?: string | null
    attachments?: OutgoingFile[]
  }) => Promise<boolean>
  onTyping: () => void
}) {
  const [draft, setDraft] = React.useState('')
  const [pending, setPending] = React.useState<Pending[]>([])
  const [sending, setSending] = React.useState(false)
  const [mentionQuery, setMentionQuery] = React.useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = React.useState(0)

  const textarea = React.useRef<HTMLTextAreaElement | null>(null)
  const fileInput = React.useRef<HTMLInputElement | null>(null)
  const lastPing = React.useRef(0)

  // A fresh conversation gets a fresh box. Carrying a half-typed message into
  // somebody else's thread is the kind of mistake that is hard to undo.
  React.useEffect(() => {
    setDraft('')
    setPending([])
    setMentionQuery(null)
  }, [conversationId])

  // Grow with the content, to a ceiling: a composer that eats the thread is
  // worse than one that scrolls.
  React.useEffect(() => {
    const element = textarea.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`
  }, [draft])

  React.useEffect(() => {
    if (replyTo) textarea.current?.focus()
  }, [replyTo])

  const matches = React.useMemo(() => {
    if (mentionQuery === null) return []
    const needle = mentionQuery.toLowerCase()
    return people.filter((person) => person.name.toLowerCase().includes(needle)).slice(0, 6)
  }, [mentionQuery, people])

  /**
   * Is the caret in an `@…` the person is still typing?
   *
   * Looks BACKWARDS from the caret to the nearest `@` and only offers the
   * autocomplete when nothing between them could end a name. Without the
   * newline and `@` tests, a message containing an email address would pop the
   * roster open halfway through typing it.
   */
  function updateMentionQuery(value: string, caret: number) {
    const upto = value.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1) {
      setMentionQuery(null)
      return
    }
    const fragment = upto.slice(at + 1)
    if (fragment.includes('\n') || fragment.includes('@') || fragment.length > 40) {
      setMentionQuery(null)
      return
    }
    // An `@` must start a word, or every email address is a mention.
    const before = at === 0 ? '' : upto[at - 1]
    if (before && /[\p{L}\p{N}]/u.test(before)) {
      setMentionQuery(null)
      return
    }
    setMentionQuery(fragment)
    setMentionIndex(0)
  }

  function insertMention(person: MessagingPerson) {
    const element = textarea.current
    if (!element) return
    const caret = element.selectionStart ?? draft.length
    const upto = draft.slice(0, caret)
    const at = upto.lastIndexOf('@')
    if (at === -1) return
    const next = `${draft.slice(0, at)}@${person.name} ${draft.slice(caret)}`
    setDraft(next)
    setMentionQuery(null)
    // Put the caret after the inserted name, on the next frame — React has not
    // written the new value to the element yet.
    const position = at + person.name.length + 2
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(position, position)
    })
  }

  function addEmoji(emoji: string) {
    setDraft((current) => `${current}${emoji}`)
    textarea.current?.focus()
  }

  /* ---------------------------------------------------------------- files */

  const upload = React.useCallback(
    async (file: File, options: { voice?: boolean; durationSeconds?: number } = {}) => {
      const localId = `${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 8)}`
      setPending((current) => [
        ...current,
        { localId, name: file.name, sizeBytes: file.size, voice: options.voice },
      ])

      // An image's natural size travels with it, so the bubble reserves the
      // right shape before the bytes arrive and the thread does not jump as
      // each photo loads.
      const dimensions = file.type.startsWith('image/') ? await measureImage(file) : null

      try {
        const stored = await uploadFile(
          file,
          options.voice ? 'chat_voice' : file.type.startsWith('image/') ? 'chat_image' : 'chat_file'
        )
        setPending((current) =>
          current.map((row) =>
            row.localId === localId
              ? {
                  ...row,
                  uploaded: {
                    key: stored.key,
                    name: stored.fileName,
                    contentType: stored.contentType,
                    sizeBytes: file.size,
                    durationSeconds: options.durationSeconds,
                    width: dimensions?.width,
                    height: dimensions?.height,
                  },
                }
              : row
          )
        )
      } catch (err) {
        setPending((current) =>
          current.map((row) => (row.localId === localId ? { ...row, failed: true } : row))
        )
        toast.error(err instanceof ApiClientError ? err.message : 'That file could not be attached')
      }
    },
    []
  )

  const addFiles = React.useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files)
      const room = MAX_MESSAGE_ATTACHMENTS - pending.length
      if (room <= 0) {
        toast.error(`A message can carry ${MAX_MESSAGE_ATTACHMENTS} attachments.`)
        return
      }
      if (list.length > room) {
        toast.error(`Only the first ${room} were attached — a message carries ${MAX_MESSAGE_ATTACHMENTS}.`)
      }
      list.slice(0, room).forEach((file) => void upload(file))
    },
    [pending.length, upload]
  )

  function onRecorded(recording: Recording) {
    void upload(recording.file, { voice: true, durationSeconds: recording.durationSeconds })
  }

  /* ----------------------------------------------------------------- send */

  const uploading = pending.some((row) => !row.uploaded && !row.failed)
  const ready = pending.filter((row) => row.uploaded).map((row) => row.uploaded!)
  const canSubmit = (!!draft.trim() || ready.length > 0) && !uploading && !sending

  async function submit() {
    if (!canSubmit) return
    setSending(true)
    const ok = await onSend({
      body: draft.trim() || null,
      replyToId: replyTo?.id ?? null,
      attachments: ready,
    })
    setSending(false)
    if (!ok) return
    // Only cleared on success. A failed send leaves the words in the box,
    // because the one thing worse than a message that did not send is a
    // message that did not send and is gone.
    setDraft('')
    setPending([])
    setMentionQuery(null)
    onCancelReply()
  }

  if (!canPost) {
    return (
      <div className="border-t border-line bg-card px-4 py-3">
        <p className="text-center text-[13px] text-ink-muted">
          {disabledReason ?? 'You cannot post in this conversation.'}
        </p>
      </div>
    )
  }

  return (
    <div
      className="border-t border-line bg-card"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        if (!event.dataTransfer.files.length) return
        event.preventDefault()
        addFiles(event.dataTransfer.files)
      }}
    >
      {replyTo ? (
        <div className="flex items-start gap-2 border-b border-line bg-page px-4 py-2">
          <div className="min-w-0 flex-1 border-l-2 border-brand-600 pl-2">
            <p className="text-[11px] font-semibold text-ink-muted">
              Replying to {replyTo.senderName}
            </p>
            <p className="line-clamp-1 text-[12px] text-ink-muted">
              {replyTo.body || 'Attachment'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelReply}
            className="focus-ring grid size-7 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-card hover:text-ink"
            aria-label="Cancel reply"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {pending.length ? (
        <ul className="flex flex-wrap gap-2 border-b border-line px-4 py-2">
          {pending.map((row) => (
            <li
              key={row.localId}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2 py-1 text-[12px]',
                row.failed ? 'border-danger text-danger' : 'border-line text-ink-muted'
              )}
            >
              {!row.uploaded && !row.failed ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : null}
              <span className="max-w-[12rem] truncate">{row.name}</span>
              <span className="tabular-nums">{formatSize(row.sizeBytes)}</span>
              <button
                type="button"
                onClick={() =>
                  setPending((current) => current.filter((item) => item.localId !== row.localId))
                }
                className="focus-ring rounded text-ink-muted hover:text-danger"
                aria-label={`Remove ${row.name}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative px-3 py-2">
        {matches.length ? (
          <ul className="absolute bottom-full left-3 z-20 mb-2 w-64 overflow-hidden rounded-xl border border-line bg-card py-1 shadow-pop">
            {matches.map((person, index) => (
              <li key={person.id}>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    // mousedown, not click: the textarea must not lose focus
                    // before the insertion reads its caret position.
                    event.preventDefault()
                    insertMention(person)
                  }}
                  onMouseEnter={() => setMentionIndex(index)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px]',
                    index === mentionIndex ? 'bg-page text-ink' : 'text-ink-muted'
                  )}
                >
                  <Avatar className="size-6">
                    {person.photoUrl ? <AvatarImage src={person.photoUrl} alt="" /> : null}
                    <AvatarFallback className="bg-brand-600 text-[9px] text-white">
                      {initials(person.name, person.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 truncate font-medium">{person.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex items-end gap-1.5">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-page hover:text-ink"
            aria-label="Attach a file"
          >
            <Paperclip className="size-[18px]" />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files?.length) addFiles(event.target.files)
              // Reset, so picking the same file twice in a row still fires.
              event.target.value = ''
            }}
          />

          <DropdownMenu>
            <DropdownMenuTrigger
              className="focus-ring grid size-9 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-page hover:text-ink"
              aria-label="Add an emoji"
            >
              <Smile className="size-[18px]" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="flex w-auto gap-0.5 p-1">
              {REACTION_EMOJI.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => addEmoji(emoji)}
                  className="focus-ring grid size-8 place-items-center rounded-lg text-base hover:bg-page"
                  aria-label={`Insert ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <textarea
            ref={textarea}
            rows={1}
            value={draft}
            maxLength={8000}
            placeholder="Write a message"
            aria-label="Message"
            onChange={(event) => {
              setDraft(event.target.value)
              updateMentionQuery(event.target.value, event.target.selectionStart ?? 0)
              // Throttled, so a fast typist sends one ping every few seconds
              // rather than one per keystroke.
              const now = Date.now()
              if (now - lastPing.current > TYPING_PING_MS) {
                lastPing.current = now
                onTyping()
              }
            }}
            onPaste={(event) => {
              // A screenshot from the clipboard arrives as a file with no name.
              const files = Array.from(event.clipboardData.files)
              if (files.length) {
                event.preventDefault()
                addFiles(files)
              }
            }}
            onKeyDown={(event) => {
              if (matches.length) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setMentionIndex((index) => (index + 1) % matches.length)
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setMentionIndex((index) => (index - 1 + matches.length) % matches.length)
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  insertMention(matches[mentionIndex])
                  return
                }
                if (event.key === 'Escape') {
                  setMentionQuery(null)
                  return
                }
              }
              if (event.key === 'Enter' && !event.shiftKey && !isTouch()) {
                event.preventDefault()
                void submit()
              }
            }}
            className={
              'scrollbar-thin min-h-10 w-full resize-none rounded-lg border border-line bg-card px-3 py-2 ' +
              'text-sm leading-relaxed text-ink placeholder:text-ink-muted/70 focus-ring ' +
              'focus-visible:border-brand-600'
            }
          />

          <VoiceRecorder onRecorded={onRecorded} disabled={sending} />

          <Button
            size="icon"
            onClick={submit}
            disabled={!canSubmit}
            loading={sending}
            aria-label="Send"
            className="shrink-0"
          >
            {sending ? null : <Send />}
          </Button>
        </div>

        {uploading ? (
          <p className="px-1 pt-1 text-[11px] text-ink-muted">Uploading — Send waits for this.</p>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Does Enter mean "send"?
 *
 * On a phone it must not: there is no Shift to hold, so Enter-to-send leaves
 * somebody no way to write a second line. The test is for a device whose
 * primary pointer is coarse, which is the question actually being asked —
 * sniffing the user agent would get a touchscreen laptop wrong in both
 * directions.
 */
function isTouch(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true
}

/** An image's intrinsic size, so the bubble can reserve its shape. */
async function measureImage(file: File): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((resolve) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      // A file the browser cannot decode is still a file worth attaching; the
      // server decides whether it is a real image.
      image.onerror = () => resolve(null)
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
