/**
 * The SHAPE of a conversation, as both sides see it.
 *
 * Deliberately free of `server-only`, of `'use client'`, and of every heavy
 * import — the same discipline as `project-updates-shared.ts`. Three kinds of
 * code read this file and they do not share a runtime:
 *
 *   • `lib/messaging.ts` (server) builds these objects out of rows
 *   • the thread and composer (client) render them
 *   • both parse the SAME text with the SAME functions below
 *
 * That last one is the reason the parsers live here rather than in either side.
 * A mention the server notifies and the thread does not highlight is a bug
 * nobody reports and everybody notices, and the only way to be sure the two
 * agree is for there to be one implementation.
 */
import type {
  AttachmentKind,
  ConversationKind,
  ConversationMemberRole,
  ConversationPosting,
  MessageKind,
  UserRole,
} from '@/types/db'

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface MessagingPerson {
  id: string
  /** Already resolved: full name, or the email when there is no name yet. */
  name: string
  email: string | null
  /** A `/api/files/view` URL, or null. Never a raw storage key. */
  photoUrl: string | null
  role: UserRole
  /** Shown beside the name in a picker, so two Priyas are tellable apart. */
  jobTitle: string | null
}

export interface ConversationMemberView extends MessagingPerson {
  memberRole: ConversationMemberRole
  /** Backs read receipts: everything up to here, they have seen. */
  lastReadAt: string | null
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string
  kind: ConversationKind
  /** What to put in the list: the other person for a DM, the room's name otherwise. */
  title: string
  /** The second line under the title — a project's code, or "5 members". */
  subtitle: string | null
  /**
   * What the room is FOR, as its administrators wrote it.
   *
   * Carried on the summary rather than fetched by the settings panel so that
   * editing it starts from what is there. A panel that opened with an empty box
   * would look like the description had been lost, and anybody who then saved
   * another setting would have made that true.
   */
  description: string | null
  color: string
  /** A `/api/files/view` URL for the room's picture or the other person's photo. */
  avatarUrl: string | null
  projectId: string | null
  archived: boolean
  posting: ConversationPosting
  memberCount: number
  /** A handful of people, for the avatar stack. Not the whole roster. */
  participants: MessagingPerson[]
  lastMessageAt: string
  lastMessageText: string | null
  lastMessageBy: string | null
  lastMessageKind: MessageKind | null
  unread: number
  muted: boolean
  pinned: boolean
  myRole: ConversationMemberRole
  /**
   * True when the caller is here only as a workspace ADMINISTRATOR — they can
   * see that the room exists and manage it, and cannot read a word of it.
   *
   * The UI needs this as its own flag rather than inferring it from an empty
   * message list, because "nobody has said anything yet" and "you are not in
   * this room" look identical from a count of zero and need opposite screens.
   */
  observerOnly: boolean
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface MessageAttachmentView {
  id: string
  kind: AttachmentKind
  /** Opens inline (an `<img>`, an `<audio>`). */
  url: string
  /** Same object, with a filename, as a download. */
  downloadUrl: string
  name: string
  mimeType: string
  sizeBytes: number
  durationSeconds: number | null
  width: number | null
  height: number | null
}

export interface MessageReactionView {
  emoji: string
  count: number
  /** Did the caller react with this one? Decides the chip's state and the toggle. */
  mine: boolean
  /** Who reacted, for the tooltip. Capped — see `REACTION_NAMES_SHOWN`. */
  names: string[]
}

/** The slice of a quoted message a reply needs to render. */
export interface MessageQuote {
  id: string
  senderName: string
  body: string | null
  kind: MessageKind
  deleted: boolean
}

export interface MessageView {
  id: string
  conversationId: string
  senderId: string | null
  /** The SNAPSHOT taken when it was sent, so a leaver's messages still read. */
  senderName: string
  senderPhotoUrl: string | null
  kind: MessageKind
  body: string | null
  createdAt: string
  editedAt: string | null
  deleted: boolean
  pinned: boolean
  mine: boolean
  mentions: string[]
  systemEvent: string | null
  replyTo: MessageQuote | null
  attachments: MessageAttachmentView[]
  reactions: MessageReactionView[]
  /**
   * Set only on a bubble the client drew before the server confirmed it.
   * Absent on everything that came back from a query, which is how the thread
   * tells its own optimistic rows apart from real ones.
   */
  status?: 'sending' | 'failed'
  clientToken?: string | null
}

export interface ConversationDetail {
  conversation: ConversationSummary
  members: ConversationMemberView[]
  /** Oldest first — the order the thread renders in. */
  messages: MessageView[]
  /** False when there is older history still to page in. */
  atStart: boolean
  canPost: boolean
  /** Rename, re-colour, archive, change the roster, delete. */
  canManage: boolean
  pinned: MessageView[]
}

/** How many names a reaction chip's tooltip lists before it says "and N more". */
export const REACTION_NAMES_SHOWN = 8

// ---------------------------------------------------------------------------
// Storage URLs
// ---------------------------------------------------------------------------

/**
 * The ONLY way a stored object is referenced in this feature.
 *
 * Never a presigned URL and never a bucket path: `/api/files/view` re-verifies
 * the caller and, for a `chat-` key, re-asks the database whether they are in
 * the conversation — see the box in that route. Passing `name` is what makes a
 * saved file land as `voice-note.webm` rather than as the storage uuid.
 */
export function fileViewUrl(key: string, name?: string | null): string {
  const params = new URLSearchParams({ key })
  if (name) params.set('name', name)
  return `/api/files/view?${params.toString()}`
}

export function fileDownloadUrl(key: string, name: string): string {
  return `/api/files/view?${new URLSearchParams({ key, download: name }).toString()}`
}

// ---------------------------------------------------------------------------
// Attachment classification
// ---------------------------------------------------------------------------

/**
 * Which of the four shapes an attachment renders as.
 *
 * Driven by the SNIFFED mime type that `/api/files/finalize` returned, not by
 * the browser's claim and not by the extension — those are the two things an
 * uploader controls. `isVoice` is passed in rather than guessed because a voice
 * note and an attached video arrive in the same WebM container (see
 * `VOICE_MIMES`) and only the caller knows which one the person meant.
 */
export function attachmentKindFor(mimeType: string, isVoice = false): AttachmentKind {
  const type = (mimeType || '').toLowerCase().split(';')[0].trim()
  if (isVoice) return 'audio'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  return 'file'
}

/** The message's own `kind` — what a preview and a push notification will say. */
export function messageKindFor(attachments: Array<{ kind: AttachmentKind }>): MessageKind {
  if (!attachments.length) return 'text'
  if (attachments.some((a) => a.kind === 'audio')) return 'voice'
  if (attachments.every((a) => a.kind === 'image')) return 'image'
  return 'file'
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

/**
 * Who an `@` in this text named.
 *
 * MATCHED LONGEST NAME FIRST, which is the whole subtlety. Rosters contain
 * "Priya" and "Priya Nair", and a shortest-first scan turns "@Priya Nair" into
 * a mention of Priya followed by the stray word "Nair" — so the sort below is
 * load bearing, not tidiness.
 *
 * Matching display names rather than a client-supplied id list is deliberate:
 * an id list is a second channel the browser controls, and a browser that can
 * name its own mentions can notify anybody in the workspace from a room they
 * share with nobody. Here the only mentions that exist are the ones visible in
 * the text, resolved against the roster the server already trusts.
 *
 * Returns the matched spans as well as the ids, so the renderer highlights
 * EXACTLY what the notifier counted.
 */
export interface MentionHit {
  start: number
  end: number
  profileId: string
  label: string
}

export function findMentions(
  body: string | null | undefined,
  people: Array<{ id: string; name: string }>
): MentionHit[] {
  if (!body) return []
  const candidates = people
    .filter((person) => person.name.trim().length > 0)
    .sort((a, b) => b.name.length - a.name.length)

  const hits: MentionHit[] = []
  const lower = body.toLowerCase()
  let index = lower.indexOf('@')

  while (index !== -1) {
    const match = candidates.find((person) =>
      lower.startsWith(person.name.toLowerCase(), index + 1)
    )
    if (match) {
      const end = index + 1 + match.name.length
      // `@Priyanka` must not read as a mention of `Priya`. A name may only be
      // followed by something that is not part of a longer word.
      const next = body[end]
      if (!next || !/[\p{L}\p{N}]/u.test(next)) {
        hits.push({ start: index, end, profileId: match.id, label: match.name })
        index = lower.indexOf('@', end)
        continue
      }
    }
    index = lower.indexOf('@', index + 1)
  }

  return hits
}

export function mentionedIds(
  body: string | null | undefined,
  people: Array<{ id: string; name: string }>
): string[] {
  return Array.from(new Set(findMentions(body, people).map((hit) => hit.profileId)))
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Split text into plain runs, links and mentions, for rendering.
 *
 * URLS ARE DETECTED HERE AND FETCHED NOWHERE. There is no unfurl, no preview
 * card and no server-side HEAD request, because a URL a user typed is a URL the
 * server would then request on their behalf — an SSRF primitive aimed at
 * whatever the deployment can reach. A link that is clickable, labelled with
 * its own hostname and opened with `rel="noopener noreferrer"` is the whole
 * feature.
 *
 * Only `http` and `https` survive. `javascript:` and `data:` are not URLs a
 * message is allowed to make clickable, and the scheme test is an allowlist so
 * the next scheme somebody invents is excluded by default.
 */
export type TextSegment =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }
  | { type: 'mention'; text: string; profileId: string }

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()[\]{}"']+/giu

export function segmentMessage(
  body: string | null | undefined,
  people: Array<{ id: string; name: string }> = []
): TextSegment[] {
  if (!body) return []

  type Span = { start: number; end: number; segment: TextSegment }
  const spans: Span[] = []

  for (const hit of findMentions(body, people)) {
    spans.push({
      start: hit.start,
      end: hit.end,
      segment: { type: 'mention', text: `@${hit.label}`, profileId: hit.profileId },
    })
  }

  for (const match of body.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    // Trailing punctuation belongs to the sentence, not to the address:
    // "see https://acme.com." must not link the full stop.
    const raw = match[0].replace(/[.,;:!?)\]}'"]+$/u, '')
    if (!raw) continue
    let href: string
    try {
      const url = new URL(raw)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
      href = url.toString()
    } catch {
      continue
    }
    spans.push({ start, end: start + raw.length, segment: { type: 'link', text: raw, href } })
  }

  spans.sort((a, b) => a.start - b.start)

  const out: TextSegment[] = []
  let cursor = 0
  for (const span of spans) {
    // A mention and a URL cannot legitimately overlap; if they do, the first
    // one wins and the second is rendered as the plain text it sits inside.
    if (span.start < cursor) continue
    if (span.start > cursor) out.push({ type: 'text', text: body.slice(cursor, span.start) })
    out.push(span.segment)
    cursor = span.end
  }
  if (cursor < body.length) out.push({ type: 'text', text: body.slice(cursor) })

  return out
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** `0:07`, `1:42`, `12:05`. What a voice note's length looks like. */
export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

/**
 * The time on a bubble. Today's messages show a clock and nothing else; older
 * ones need the date, because "14:02" on its own is useless three days later.
 */
export function messageTime(iso: string): string {
  const at = new Date(iso)
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function messageDateLabel(iso: string): string {
  const at = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  if (sameDay(at, today)) return 'Today'
  if (sameDay(at, yesterday)) return 'Yesterday'
  return at.toLocaleDateString(undefined, {
    weekday: at.getFullYear() === today.getFullYear() ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: at.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

/** `2:14 PM · 3 Oct` — the full stamp, for a tooltip. */
export function messageFullTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The list's right-hand timestamp: a clock today, a date before that. */
export function conversationTime(iso: string): string {
  const at = new Date(iso)
  const now = new Date()
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate()
  if (sameDay) return messageTime(iso)
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000)
  if (days < 7) return at.toLocaleDateString(undefined, { weekday: 'short' })
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * Should this message share the previous one's avatar and name?
 *
 * Only when it is the same person, within a few minutes, with no day boundary
 * and no system line between them. Grouping is what stops a rapid exchange
 * reading as a column of repeated headshots.
 */
const GROUP_WINDOW_MS = 5 * 60 * 1000

export function continuesGroup(current: MessageView, previous: MessageView | undefined): boolean {
  if (!previous) return false
  if (current.kind === 'system' || previous.kind === 'system') return false
  if (current.senderId !== previous.senderId) return false
  if (messageDateLabel(current.createdAt) !== messageDateLabel(previous.createdAt)) return false
  return (
    new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < GROUP_WINDOW_MS
  )
}

/** `1.2 MB`. A local copy so this module stays importable from anywhere. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** What the composer's placeholder and an empty thread call this room. */
export function conversationNoun(kind: ConversationKind): string {
  if (kind === 'direct') return 'conversation'
  if (kind === 'project') return 'project room'
  return 'group'
}
