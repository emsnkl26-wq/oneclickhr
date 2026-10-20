import 'server-only'

/**
 * Loading and writing conversations.
 *
 * EVERY READ RUNS ON THE CALLER'S RLS-SCOPED CLIENT. There is no role branching
 * in this file for visibility: `conversations_select` and `messages_select`
 * (062) decide what comes back, so the same function returns a room's whole
 * history to a member and nothing at all to an administrator who is not in it.
 * Where this file does look at a role, it is to decide what the UI may OFFER —
 * never what the database will hand over.
 *
 * SHAPE OF A THREAD LOAD. Five queries, none of them per-message:
 *
 *   conversation → members, messages page            (three in parallel)
 *   then         → attachments, reactions, quotes    (by message id)
 *
 * The second round needs the message ids, which is its only reason for
 * existing. Everything a bubble renders comes out of it; opening the info panel
 * is a separate call and nothing else is.
 *
 * WHY WRITES ARE SPLIT BETWEEN THE TWO CLIENTS. A message, an edit, a reaction
 * and a membership change are all written with the USER'S client, so the
 * policies prove them rather than this code asserting them. Exactly two things
 * use the service role, and both are narrow and argued where they happen:
 *
 *   • the initial roster of a brand-new conversation (`createConversation`)
 *   • system lines — "X added Y" — which `messages_insert` forbids a client
 *     from writing at all, on purpose (`systemMessage`)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { after } from 'next/server'
import { sendPushToUsers } from '@/lib/push/send'
import { cardPathFor } from '@/lib/notifications/events'
import { truncate } from '@/lib/utils'
import {
  attachmentKindFor,
  fileDownloadUrl,
  fileViewUrl,
  mentionedIds,
  messageKindFor,
  REACTION_NAMES_SHOWN,
  type ConversationDetail,
  type ConversationMemberView,
  type ConversationSummary,
  type MessageAttachmentView,
  type MessageReactionView,
  type MessageView,
  type MessagingPerson,
} from '@/lib/messaging-shared'
import type { AppContext } from '@/lib/auth/context'
import type {
  AttachmentKind,
  ConversationKind,
  ConversationMemberRole,
  ConversationPosting,
  MessageKind,
  UserRole,
} from '@/types/db'

/** The first page of a thread. Deep enough to fill a tall screen in one go. */
export const MESSAGE_PAGE = 40

// ---------------------------------------------------------------------------
// Rows, as they come back
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
  role: UserRole
  designation?: string | null
}

interface ConversationRow {
  id: string
  kind: ConversationKind
  name: string | null
  description: string | null
  color: string
  avatar_url: string | null
  project_id: string | null
  posting: ConversationPosting
  created_by: string | null
  archived_at: string | null
  last_message_at: string
  direct_key: string | null
}

/**
 * The conversation list's one line of content.
 *
 * A SEPARATE TABLE AND THEREFORE A SEPARATE QUERY, because its policy is
 * membership while `conversations` admits an administrator to the rooms it
 * manages — see the header of `conversation_previews` in 062. The practical
 * consequence here is pleasant: an observer's query simply returns no preview
 * row, so there is nothing to remember to blank out.
 */
interface PreviewRow {
  conversation_id: string
  last_message_text: string | null
  last_message_by: string | null
  last_message_kind: MessageKind | null
}

interface MemberRow {
  conversation_id: string
  profile_id: string
  role: ConversationMemberRole
  last_read_at: string | null
  muted: boolean
  pinned: boolean
}

interface MessageRowShape {
  id: string
  conversation_id: string
  sender_id: string | null
  sender_name: string | null
  kind: MessageKind
  body: string | null
  reply_to_id: string | null
  mentions: string[] | null
  edited_at: string | null
  deleted_at: string | null
  pinned_at: string | null
  system_event: string | null
  created_at: string
}

const CONVERSATION_COLUMNS =
  'id, kind, name, description, color, avatar_url, project_id, posting, created_by, ' +
  'archived_at, last_message_at, direct_key'

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, sender_name, kind, body, reply_to_id, mentions, ' +
  'edited_at, deleted_at, pinned_at, system_event, created_at'

const PROFILE_COLUMNS = 'id, full_name, email, photo_url, role, designation'

function personFrom(row: ProfileRow): MessagingPerson {
  return {
    id: row.id,
    name: row.full_name || row.email || 'Someone',
    email: row.email ?? null,
    photoUrl: row.photo_url ? fileViewUrl(row.photo_url) : null,
    role: row.role,
    jobTitle: row.designation ?? null,
  }
}

/**
 * Everyone in the workspace, as the pickers and the roster need them.
 *
 * `profiles_select` (002) already lets anyone in an active tenant see their
 * colleagues — that is what makes task assignees and meeting attendees work —
 * so this needs no special permission and gets none. Inactive profiles are
 * excluded: a leaver is not somebody to start a new conversation with, and
 * their past messages read from their snapshot regardless.
 */
export async function listPeople(supabase: SupabaseClient): Promise<MessagingPerson[]> {
  const { data } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('is_active', true)
    .order('full_name')
  return ((data ?? []) as ProfileRow[]).map(personFrom)
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * Every conversation the caller can see, newest activity first, with unread.
 *
 * Four queries flat, whatever the number of conversations:
 *
 *   conversations (RLS-scoped) ─┐
 *   my memberships              ├─ in parallel
 *   everyone's memberships      │   (the roster, for avatar stacks)
 *   people                     ─┘
 *   messaging_unread()             one RPC for the whole badge
 *
 * PINNED FIRST, then recency. A pinned conversation that fell to position 30
 * because it has been quiet is a pin that does nothing.
 */
export async function listConversations(
  supabase: SupabaseClient,
  ctx: AppContext
): Promise<{ conversations: ConversationSummary[]; people: MessagingPerson[]; error: boolean }> {
  const [rooms, people, unread] = await Promise.all([
    supabase.from('conversations').select(CONVERSATION_COLUMNS).order('last_message_at', { ascending: false }),
    listPeople(supabase),
    supabase.rpc('messaging_unread'),
  ])

  const conversationRows = (rooms.data ?? []) as unknown as ConversationRow[]
  const ids = conversationRows.map((row) => row.id)

  let memberRows: MemberRow[] = []
  let projects: Array<{ id: string; code: string; name: string }> = []
  let previews: PreviewRow[] = []
  if (ids.length) {
    const projectIds = Array.from(
      new Set(conversationRows.map((row) => row.project_id).filter((id): id is string => !!id))
    )
    const [members, projectData, previewData] = await Promise.all([
      supabase
        .from('conversation_members')
        .select('conversation_id, profile_id, role, last_read_at, muted, pinned')
        .in('conversation_id', ids),
      projectIds.length
        ? supabase.from('projects').select('id, code, name').in('id', projectIds)
        : Promise.resolve({ data: [] as Array<{ id: string; code: string; name: string }> }),
      supabase
        .from('conversation_previews')
        .select('conversation_id, last_message_text, last_message_by, last_message_kind')
        .in('conversation_id', ids),
    ])
    memberRows = (members.data ?? []) as MemberRow[]
    projects = (projectData.data ?? []) as Array<{ id: string; code: string; name: string }>
    previews = (previewData.data ?? []) as unknown as PreviewRow[]
  }

  const unreadById = new Map<string, number>(
    ((unread.data ?? []) as Array<{ conversation_id: string; unread: number }>).map((row) => [
      row.conversation_id,
      Number(row.unread) || 0,
    ])
  )
  const personById = new Map(people.map((person) => [person.id, person]))
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const previewById = new Map(previews.map((preview) => [preview.conversation_id, preview]))

  const summaries = conversationRows.map((row) =>
    summarize(row, {
      members: memberRows.filter((member) => member.conversation_id === row.id),
      personById,
      preview: previewById.get(row.id) ?? null,
      project: row.project_id ? projectById.get(row.project_id) ?? null : null,
      unread: unreadById.get(row.id) ?? 0,
      viewerId: ctx.userId,
    })
  )

  summaries.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.lastMessageAt.localeCompare(a.lastMessageAt)
  })

  return { conversations: summaries, people, error: !!rooms.error }
}

function summarize(
  row: ConversationRow,
  args: {
    members: MemberRow[]
    personById: Map<string, MessagingPerson>
    /** Null for an observer — their policy returns no preview row at all. */
    preview: PreviewRow | null
    project: { id: string; code: string; name: string } | null
    unread: number
    viewerId: string
  }
): ConversationSummary {
  const mine = args.members.find((member) => member.profile_id === args.viewerId) ?? null
  const others = args.members.filter((member) => member.profile_id !== args.viewerId)

  /*
   * A direct message is NAMED AFTER THE OTHER PERSON, resolved here rather than
   * stored, because the answer differs per reader: the same row is "Priya" to
   * one side and "Rajesh" to the other. Falling back to the room's member count
   * covers the one odd case — a DM whose counterpart has been deleted — without
   * rendering a blank row.
   */
  const counterpart = row.kind === 'direct' ? args.personById.get(others[0]?.profile_id ?? '') : undefined
  const title =
    row.kind === 'direct'
      ? counterpart?.name ?? 'Conversation'
      : row.name ?? (row.kind === 'project' ? args.project?.name ?? 'Project' : 'Group')

  const subtitle =
    row.kind === 'direct'
      ? counterpart?.jobTitle ?? counterpart?.email ?? null
      : row.kind === 'project' && args.project
        ? `${args.project.code} · ${args.project.name}`
        : `${args.members.length} ${args.members.length === 1 ? 'member' : 'members'}`

  return {
    id: row.id,
    kind: row.kind,
    title,
    subtitle,
    description: row.description,
    color: row.color,
    avatarUrl:
      row.kind === 'direct'
        ? counterpart?.photoUrl ?? null
        : row.avatar_url
          ? fileViewUrl(row.avatar_url)
          : null,
    projectId: row.project_id,
    archived: !!row.archived_at,
    posting: row.posting,
    memberCount: args.members.length,
    participants: others
      .map((member) => args.personById.get(member.profile_id))
      .filter((person): person is MessagingPerson => !!person)
      .slice(0, 4),
    lastMessageAt: row.last_message_at,
    /*
     * No `mine ? …` guard, and that is the improvement.
     *
     * The preview used to be a column on `conversations`, which an
     * administrator can read, so every field had to be blanked here by hand —
     * one forgotten ternary away from leaking the latest line of every group.
     * It is now its own members-only table, so an observer's query returns
     * nothing and the privacy rule is enforced by Postgres rather than by this
     * expression remembering to.
     */
    lastMessageText: args.preview?.last_message_text ?? null,
    lastMessageBy: args.preview?.last_message_by ?? null,
    lastMessageKind: args.preview?.last_message_kind ?? null,
    unread: args.unread,
    muted: mine?.muted ?? false,
    pinned: mine?.pinned ?? false,
    myRole: mine?.role ?? 'member',
    // No membership row, yet the conversation came back: the only way that
    // happens is `conversations_select`'s administrator arm.
    observerOnly: !mine,
  }
}

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

/**
 * One conversation, with a page of its history.
 *
 * Returns null when the caller may not see it at all, which RLS answers by
 * returning no row — this function never decides it. An ADMINISTRATOR who is
 * not a member gets the conversation with an empty thread and
 * `observerOnly: true`, because `messages_select` is membership-only while
 * `conversations_select` is not: that asymmetry is the privacy rule in 062, and
 * the UI reads it off the flag rather than guessing from a message count.
 */
export async function loadConversation(
  supabase: SupabaseClient,
  ctx: AppContext,
  conversationId: string,
  options: { before?: string; limit?: number } = {}
): Promise<ConversationDetail | null> {
  const { data: row } = await supabase
    .from('conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('id', conversationId)
    .maybeSingle()

  if (!row) return null
  const conversation = row as unknown as ConversationRow

  const limit = options.limit ?? MESSAGE_PAGE

  const [memberResult, pageResult, pinnedResult] = await Promise.all([
    supabase
      .from('conversation_members')
      .select('conversation_id, profile_id, role, last_read_at, muted, pinned')
      .eq('conversation_id', conversationId),
    historyQuery(supabase, conversationId, { before: options.before, limit }),
    supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('conversation_id', conversationId)
      .not('pinned_at', 'is', null)
      .is('deleted_at', null)
      .order('pinned_at', { ascending: false })
      .limit(20),
  ])

  const members = (memberResult.data ?? []) as MemberRow[]
  const people = await listPeople(supabase)
  const personById = new Map(people.map((person) => [person.id, person]))

  let project: { id: string; code: string; name: string } | null = null
  if (conversation.project_id) {
    const { data } = await supabase
      .from('projects')
      .select('id, code, name')
      .eq('id', conversation.project_id)
      .maybeSingle()
    project = (data as typeof project) ?? null
  }

  const summary = summarize(conversation, {
    members,
    personById,
    // The thread shows the messages themselves, so the list's one-line preview
    // is of no use to it. Unread is zero for the same reason: opening a
    // conversation is reading it.
    preview: null,
    project,
    unread: 0,
    viewerId: ctx.userId,
  })

  // Newest-first out of the database (that is the index), oldest-first for the
  // reader. Hydrated together so one round of attachment and reaction lookups
  // covers the page and the pinned strip.
  const pageRows = ((pageResult.data ?? []) as unknown as MessageRowShape[]).slice().reverse()
  const pinnedRows = (pinnedResult.data ?? []) as unknown as MessageRowShape[]
  const hydrated = await hydrate(supabase, [...pageRows, ...pinnedRows], ctx, personById)
  const byId = new Map(hydrated.map((message) => [message.id, message]))

  const mine = members.find((member) => member.profile_id === ctx.userId)
  const canManage =
    mine?.role === 'admin' || (ctx.role === 'org' && conversation.kind !== 'direct')

  return {
    conversation: summary,
    members: members
      .map((member) => {
        const person = personById.get(member.profile_id)
        if (!person) return null
        return {
          ...person,
          memberRole: member.role,
          lastReadAt: member.last_read_at,
        } satisfies ConversationMemberView
      })
      .filter((member): member is ConversationMemberView => !!member)
      .sort((a, b) => (a.memberRole === b.memberRole ? a.name.localeCompare(b.name) : a.memberRole === 'admin' ? -1 : 1)),
    messages: pageRows.map((row) => byId.get(row.id)).filter((m): m is MessageView => !!m),
    atStart: pageRows.length < limit,
    canPost: !!mine && !conversation.archived_at && (conversation.posting === 'everyone' || canManage),
    canManage,
    pinned: pinnedRows.map((row) => byId.get(row.id)).filter((m): m is MessageView => !!m),
  }
}

/**
 * A page of one thread, newest first — which is the order the index is in.
 *
 * `before` and `after` are both STRICT comparisons. An inclusive bound would
 * re-serve the row the client already holds on every single poll of the live
 * tail, and the duplicate would have to be filtered out somewhere; strict means
 * "what I do not have", which is the only thing either caller wants.
 */
function historyQuery(
  supabase: SupabaseClient,
  conversationId: string,
  options: { before?: string; after?: string; limit: number }
) {
  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(options.limit)
  if (options.before) query = query.lt('created_at', options.before)
  if (options.after) query = query.gt('created_at', options.after)
  return query
}

/**
 * Another page of the same thread: older (the scroll) or newer (the tail).
 *
 * `atStart` is only meaningful for a backwards page, where a short page means
 * the conversation has no more history. Asked forwards it says nothing useful
 * and the caller ignores it.
 */
export async function loadMessagePage(
  supabase: SupabaseClient,
  ctx: AppContext,
  conversationId: string,
  options: { before?: string; after?: string; limit?: number } = {}
): Promise<{ messages: MessageView[]; atStart: boolean }> {
  const limit = options.limit ?? MESSAGE_PAGE
  const { data } = await historyQuery(supabase, conversationId, {
    before: options.before,
    after: options.after,
    limit,
  })
  const rows = ((data ?? []) as unknown as MessageRowShape[]).slice().reverse()
  const people = await listPeople(supabase)
  const messages = await hydrate(
    supabase,
    rows,
    ctx,
    new Map(people.map((person) => [person.id, person]))
  )
  return { messages, atStart: rows.length < limit }
}

/**
 * Turn message rows into bubbles: attachments, reactions and quoted parents.
 *
 * Three queries for the whole page rather than three per message. The quote
 * lookup only asks for parents that are not already ON the page, which in a
 * live thread is almost none of them — a reply usually quotes something a few
 * lines up.
 */
async function hydrate(
  supabase: SupabaseClient,
  rows: MessageRowShape[],
  ctx: AppContext,
  personById: Map<string, MessagingPerson>
): Promise<MessageView[]> {
  if (!rows.length) return []

  const ids = Array.from(new Set(rows.map((row) => row.id)))
  const present = new Set(ids)
  const quoteIds = Array.from(
    new Set(
      rows
        .map((row) => row.reply_to_id)
        .filter((id): id is string => !!id && !present.has(id))
    )
  )

  const [attachmentResult, reactionResult, quoteResult] = await Promise.all([
    supabase
      .from('message_attachments')
      .select('id, message_id, kind, storage_key, file_name, mime_type, size_bytes, duration_seconds, width, height')
      .in('message_id', ids)
      .order('created_at'),
    supabase.from('message_reactions').select('message_id, profile_id, emoji').in('message_id', ids),
    quoteIds.length
      ? supabase.from('messages').select(MESSAGE_COLUMNS).in('id', quoteIds)
      : Promise.resolve({ data: [] as MessageRowShape[] }),
  ])

  interface AttachmentRow {
    id: string
    message_id: string
    kind: AttachmentKind
    storage_key: string
    file_name: string
    mime_type: string
    size_bytes: number
    duration_seconds: number | null
    width: number | null
    height: number | null
  }

  const attachments = new Map<string, MessageAttachmentView[]>()
  for (const row of (attachmentResult.data ?? []) as AttachmentRow[]) {
    const list = attachments.get(row.message_id) ?? []
    list.push({
      id: row.id,
      kind: row.kind,
      url: fileViewUrl(row.storage_key, row.file_name),
      downloadUrl: fileDownloadUrl(row.storage_key, row.file_name),
      name: row.file_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes) || 0,
      durationSeconds: row.duration_seconds,
      width: row.width,
      height: row.height,
    })
    attachments.set(row.message_id, list)
  }

  const reactions = new Map<string, MessageReactionView[]>()
  for (const row of (reactionResult.data ?? []) as Array<{
    message_id: string
    profile_id: string
    emoji: string
  }>) {
    const list = reactions.get(row.message_id) ?? []
    const existing = list.find((entry) => entry.emoji === row.emoji)
    const who = row.profile_id === ctx.userId ? 'You' : personById.get(row.profile_id)?.name ?? 'Someone'
    if (existing) {
      existing.count += 1
      if (row.profile_id === ctx.userId) existing.mine = true
      if (existing.names.length < REACTION_NAMES_SHOWN) existing.names.push(who)
    } else {
      list.push({ emoji: row.emoji, count: 1, mine: row.profile_id === ctx.userId, names: [who] })
    }
    reactions.set(row.message_id, list)
  }

  const quoteSource = new Map<string, MessageRowShape>()
  for (const row of rows) quoteSource.set(row.id, row)
  for (const row of (quoteResult.data ?? []) as unknown as MessageRowShape[]) quoteSource.set(row.id, row)

  return rows.map((row) => {
    const parent = row.reply_to_id ? quoteSource.get(row.reply_to_id) : undefined
    const deleted = !!row.deleted_at
    return {
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      senderName: row.sender_name || personById.get(row.sender_id ?? '')?.name || 'Someone',
      senderPhotoUrl: personById.get(row.sender_id ?? '')?.photoUrl ?? null,
      kind: row.kind,
      // A retracted message's text never travels, whatever is still in the
      // column. The route blanks it on retraction; this is the second lock.
      body: deleted ? null : row.body,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deleted,
      pinned: !!row.pinned_at,
      mine: !!row.sender_id && row.sender_id === ctx.userId,
      mentions: row.mentions ?? [],
      systemEvent: row.system_event,
      replyTo: parent
        ? {
            id: parent.id,
            senderName: parent.sender_name || 'Someone',
            body: parent.deleted_at ? null : parent.body,
            kind: parent.kind,
            deleted: !!parent.deleted_at,
          }
        : null,
      attachments: deleted ? [] : attachments.get(row.id) ?? [],
      reactions: reactions.get(row.id) ?? [],
    }
  })
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Find a message, across every conversation the caller is in.
 *
 * `simple` matches the configuration the GIN index in 062 was built with. Say
 * `english` here and the index is silently skipped and every search becomes a
 * sequential scan of the tenant's whole history — it still returns the right
 * rows, which is what makes it the kind of mistake nobody notices until the
 * table is large.
 */
export async function searchMessages(
  supabase: SupabaseClient,
  ctx: AppContext,
  options: { q: string; conversationId?: string; limit?: number }
): Promise<MessageView[]> {
  let query = supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .is('deleted_at', null)
    .neq('kind', 'system')
    .textSearch('body', options.q, { type: 'websearch', config: 'simple' })
    .order('created_at', { ascending: false })
    .limit(options.limit ?? 25)

  if (options.conversationId) query = query.eq('conversation_id', options.conversationId)

  const { data } = await query
  const people = await listPeople(supabase)
  return hydrate(
    supabase,
    (data ?? []) as unknown as MessageRowShape[],
    ctx,
    new Map(people.map((person) => [person.id, person]))
  )
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface NewConversation {
  kind: ConversationKind
  name?: string | null
  description?: string | null
  color?: string | null
  posting?: ConversationPosting
  projectId?: string | null
  /** For a direct message: the one other person. */
  withProfileId?: string | null
  /** For a group: everybody besides the creator. */
  memberIds?: string[]
}

export class MessagingError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'MessagingError'
    this.status = status
  }
}

/**
 * Create a conversation and its first roster.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THE ROSTER IS WRITTEN WITH THE SERVICE ROLE                          │
 * │                                                                          │
 * │ The conversation ROW is inserted with the caller's own client, so         │
 * │ `conversations_insert` proves they are entitled to create this kind of    │
 * │ conversation — including the project-manager test for a project room.     │
 * │ Nothing about that moves.                                                │
 * │                                                                          │
 * │ The member rows cannot follow the same path, because at that instant      │
 * │ nobody is a member and therefore nobody is an admin, so                   │
 * │ `app.is_conversation_admin` is false for every row but the creator's own. │
 * │ The alternatives were: widen the INSERT policy to anyone matching         │
 * │ `created_by`, which outlives the creation and lets a removed creator add  │
 * │ themselves back forever; or make the creator an admin in one statement    │
 * │ and the rest in a second, which is two round trips and still leaves the   │
 * │ first one unprovable.                                                     │
 * │                                                                          │
 * │ So the roster is one service-role insert, and it is narrowed three ways   │
 * │ before it runs: `assertTenantScope` pins the tenant to the session's;     │
 * │ every profile id is RE-READ from `profiles` and kept only if it is        │
 * │ active and in that tenant; and the conversation id came from an insert     │
 * │ the caller's own policy had just authorised. It can add a person to a     │
 * │ conversation this caller just created, in this caller's tenant, and       │
 * │ nothing else.                                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A DIRECT MESSAGE IS IDEMPOTENT. `direct_key` is unique per tenant, so a
 * second attempt loses the insert and this returns the conversation that
 * already exists — which is what "message this person" has to mean, rather
 * than a second thread with half the history in it.
 */
export async function createConversation(
  supabase: SupabaseClient,
  ctx: AppContext & { tenantId: string },
  input: NewConversation
): Promise<{ id: string; created: boolean }> {
  const admin = createAdminClient()
  const tenantId = assertTenantScope(ctx.tenantId)

  if (input.kind === 'direct') {
    const other = input.withProfileId
    if (!other) throw new MessagingError('Choose who to message.')
    if (other === ctx.userId) throw new MessagingError('You cannot message yourself.')
    await assertInTenant(admin, tenantId, [other])

    const directKey = [ctx.userId, other].sort().join(':')

    /*
     * A DIRECT MESSAGE IS INSERTED WITH THE ADMIN CLIENT.
     *
     * Unlike a group or a project room — where the caller's own
     * `conversations_insert` policy is the authorization (does this person
     * manage this project?) — a DM carries no such decision: the only rules are
     * tenant scope, an active member, and `created_by = me`, and every one of
     * them is already enforced above in TypeScript (`assertTenantScope`,
     * `assertInTenant`, the self check). Routing it through the caller's client
     * bought nothing and cost everything: the creator is not yet a member, so a
     * RETURNING `select` fails `conversations_select` and Postgres rolls the
     * insert back with it. The admin client has no such RETURNING hazard, so the
     * id comes straight back.
     */
    const { data: inserted, error: insertErr } = await admin
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        kind: 'direct',
        created_by: ctx.userId,
        direct_key: directKey,
      })
      .select('id')
      .maybeSingle()

    let id = inserted?.id as string | undefined

    if (!id) {
      /*
       * The one expected failure is the unique index doing its job: the other
       * person opened the same conversation a moment earlier (or this caller did,
       * in another tab). Re-read by the unique key and return that row — it
       * already has both of us as members.
       */
      if (insertErr && insertErr.code !== '23505') {
        console.error('[messaging] direct insert failed', insertErr)
        throw new MessagingError(conversationInsertMessage(insertErr.code), 400)
      }
      const { data: raced } = await admin
        .from('conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('direct_key', directKey)
        .maybeSingle()
      if (!raced) throw new MessagingError('That conversation could not be created.', 400)
      return { id: raced.id as string, created: false }
    }

    /*
     * BOTH SIDES OF A DM ARE PLAIN MEMBERS, and that is what makes a direct
     * message undeletable: `conversations_delete` needs an admin, a DM has
     * none, so neither person can destroy a shared history the other half of
     * which is not theirs. Leaving is still available to both.
     */
    await admin.from('conversation_members').insert([
      { conversation_id: id, profile_id: ctx.userId, tenant_id: tenantId, role: 'member', added_by: ctx.userId },
      { conversation_id: id, profile_id: other, tenant_id: tenantId, role: 'member', added_by: ctx.userId },
    ])

    return { id, created: true }
  }

  // ---- a group or a project room ------------------------------------------

  if (!input.name) throw new MessagingError('Name the group.')

  const memberIds = Array.from(new Set((input.memberIds ?? []).filter((id) => id !== ctx.userId)))

  if (input.kind === 'project' && !input.projectId) {
    throw new MessagingError('Choose a project.')
  }

  /*
   * A project room's roster is whatever the caller sent. The dialog seeds that
   * list with the project's assignees — ticked, so the common case is one
   * click — but leaves them removable, so the roster here is the deliberate
   * one, not an automatic union with everybody on the project. Authorization is
   * unchanged: `conversations_insert` has already refused anyone who does not
   * manage the project, and `assertInTenant` keeps every id inside the tenant.
   */
  const verified = await assertInTenant(admin, tenantId, memberIds)

  const created = await insertConversation(supabase, {
    tenant_id: tenantId,
    kind: input.kind,
    name: input.name,
    description: input.description ?? null,
    color: input.color ?? undefined,
    posting: input.posting ?? 'everyone',
    project_id: input.kind === 'project' ? input.projectId : null,
    created_by: ctx.userId,
  })
  if (!created.ok) throw new MessagingError(created.error, 400)

  await admin.from('conversation_members').insert([
    {
      conversation_id: created.id,
      profile_id: ctx.userId,
      tenant_id: tenantId,
      // The creator runs the room. Somebody has to be able to rename it and
      // add the person they forgot.
      role: 'admin',
      added_by: ctx.userId,
    },
    ...verified.map((id) => ({
      conversation_id: created.id,
      profile_id: id,
      tenant_id: tenantId,
      role: 'member' as const,
      added_by: ctx.userId,
    })),
  ])

  await systemMessage(tenantId, created.id, 'conversation.created', {
    actorName: displayName(ctx),
    text: `${displayName(ctx)} created this ${input.kind === 'project' ? 'project room' : 'group'}`,
  })

  return { id: created.id, created: true }
}

async function insertConversation(
  supabase: SupabaseClient,
  values: Record<string, unknown>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabase.from('conversations').insert(values).select('id').single()
  if (error || !data) {
    return { ok: false, error: conversationInsertMessage(error?.code) }
  }
  return { ok: true, id: data.id as string }
}

function conversationInsertMessage(code: string | undefined): string {
  if (code === '23505') return 'That conversation already exists.'
  if (code === '42501') return 'You do not have permission to start that conversation.'
  return 'That conversation could not be created.'
}

/**
 * Keep only the profile ids that are ACTIVE and in this tenant.
 *
 * The guard on every service-role write in this file. The ids arrived from a
 * browser, and the service role does not apply RLS — so without this, a request
 * naming another workspace's profile id would succeed at the one place in the
 * feature where nothing else was checking. The composite foreign keys in 062
 * would also refuse it, and this exists so the refusal is a sentence rather
 * than a constraint violation.
 */
async function assertInTenant(
  admin: SupabaseClient,
  tenantId: string,
  profileIds: string[]
): Promise<string[]> {
  if (!profileIds.length) return []
  const { data, error } = await admin
    .from('profiles')
    .select('id')
    .eq('tenant_id', assertTenantScope(tenantId))
    .eq('is_active', true)
    .in('id', profileIds)
  if (error) throw new MessagingError('Those people could not be checked. Please try again.', 500)
  const found = new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id))
  const missing = profileIds.filter((id) => !found.has(id))
  if (missing.length) {
    throw new MessagingError('One of those people is not in this workspace.', 400)
  }
  return profileIds
}

export function displayName(ctx: AppContext): string {
  return ctx.fullName || ctx.email || 'Someone'
}

/**
 * Narrate something that happened TO a conversation.
 *
 * Written with the service role because `messages_insert` forbids a client from
 * writing `kind = 'system'` at all — a browser that could write one could
 * fabricate "Priya left the group", and a membership log anybody can forge is
 * not a log. It is the same trade `notify.ts` makes for an employee-raised
 * notification, and it is narrow in the same way: the tenant comes from the
 * session, the conversation id from a row the caller has just been authorised
 * against, and the text from this file rather than from the request.
 *
 * NEVER THROWS. A system line is a courtesy attached to an operation that has
 * already succeeded; failing to narrate a membership change must not undo it.
 */
export async function systemMessage(
  tenantId: string,
  conversationId: string,
  event: string,
  meta: { text: string } & Record<string, unknown>
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('messages').insert({
      tenant_id: assertTenantScope(tenantId),
      conversation_id: conversationId,
      kind: 'system',
      system_event: event,
      system_meta: meta,
      body: meta.text,
    })
  } catch (err) {
    console.error('[messaging] could not write a system message', err)
  }
}

export interface OutgoingAttachment {
  key: string
  name: string
  contentType: string
  sizeBytes: number
  durationSeconds?: number
  width?: number
  height?: number
  /** True for something recorded in the composer, which decides its kind. */
  voice?: boolean
}

/**
 * Post a message.
 *
 * The message row goes in with the CALLER'S client, so `messages_insert` proves
 * authorship (`sender_id = auth.uid()`), that the room admits them, and that it
 * is not archived — none of which this function asserts for itself.
 *
 * ORDER MATTERS. The message is written first and its attachments second,
 * because `message_attachments_insert` requires a message that already exists
 * and is the caller's. If the attachment insert fails, the message is retracted
 * rather than left as a bubble whose photo never arrives.
 */
export async function sendMessage(
  supabase: SupabaseClient,
  ctx: AppContext & { tenantId: string },
  conversationId: string,
  input: {
    body: string | null
    replyToId?: string | null
    attachments: OutgoingAttachment[]
    clientToken?: string
  }
): Promise<{ id: string; createdAt: string; mentions: string[] }> {
  const tenantId = assertTenantScope(ctx.tenantId)

  /*
   * Mentions are resolved against the ROOM'S roster, not the workspace's. A
   * mention of somebody who is not in the conversation is not a mention — it is
   * a way to send a notification into a room the recipient cannot open, and
   * `@everyone`-style reach into a private group is exactly what it would be
   * used for.
   */
  const roster = await conversationRoster(supabase, conversationId)
  const mentions = mentionedIds(input.body, roster)

  const attachmentKinds = input.attachments.map((attachment) => ({
    kind: attachmentKindFor(attachment.contentType, attachment.voice),
  }))

  const { data, error } = await supabase
    .from('messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_id: ctx.userId,
      // Snapshots, so the thread still reads after the sender leaves.
      sender_name: displayName(ctx),
      sender_role: ctx.role,
      kind: messageKindFor(attachmentKinds),
      body: input.body,
      reply_to_id: input.replyToId ?? null,
      mentions,
      client_token: input.clientToken ?? null,
    })
    .select('id, created_at')
    .single()

  if (error || !data) {
    /*
     * A duplicate client token means THIS EXACT SEND already landed — a retry
     * after a dropped response. Returning the original is the only answer that
     * leaves the room with one copy of the message.
     */
    if (error?.code === '23505' && input.clientToken) {
      const { data: existing } = await supabase
        .from('messages')
        .select('id, created_at')
        .eq('conversation_id', conversationId)
        .eq('client_token', input.clientToken)
        .maybeSingle()
      if (existing) {
        return { id: existing.id as string, createdAt: existing.created_at as string, mentions }
      }
    }
    if (error?.code === '42501') {
      throw new MessagingError('You cannot post in this conversation.', 403)
    }
    console.error('[messaging] send failed', error?.code, error?.message)
    throw new MessagingError('That message could not be sent.', 400)
  }

  if (input.attachments.length) {
    const { error: attachError } = await supabase.from('message_attachments').insert(
      input.attachments.map((attachment) => ({
        tenant_id: tenantId,
        conversation_id: conversationId,
        message_id: data.id,
        kind: attachmentKindFor(attachment.contentType, attachment.voice),
        storage_key: attachment.key,
        file_name: attachment.name,
        mime_type: attachment.contentType,
        size_bytes: attachment.sizeBytes,
        duration_seconds: attachment.durationSeconds ?? null,
        width: attachment.width ?? null,
        height: attachment.height ?? null,
      }))
    )

    if (attachError) {
      // Never leave a bubble whose content cannot arrive.
      await supabase
        .from('messages')
        .update({ deleted_at: new Date().toISOString(), body: null })
        .eq('id', data.id)
      console.error('[messaging] attachments failed', attachError.code, attachError.message)
      throw new MessagingError('The attachment could not be saved.', 400)
    }
  }

  // Reading your own message is implied by sending it.
  await markRead(supabase, conversationId, ctx.userId, data.created_at as string)

  // The resolved mentions travel back with the row, so the notifier does not
  // have to re-read the roster this function has already read.
  return { id: data.id as string, createdAt: data.created_at as string, mentions }
}

/** Who is in this conversation, as `findMentions` wants them. */
export async function conversationRoster(
  supabase: SupabaseClient,
  conversationId: string
): Promise<Array<{ id: string; name: string }>> {
  const { data: members } = await supabase
    .from('conversation_members')
    .select('profile_id')
    .eq('conversation_id', conversationId)
  const ids = ((members ?? []) as Array<{ profile_id: string }>).map((row) => row.profile_id)
  if (!ids.length) return []
  const { data } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
  return ((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
    (row) => ({ id: row.id, name: row.full_name || row.email || '' })
  )
}

/**
 * Move one person's read mark forward.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `profileId` IS NOT OPTIONAL, AND THE FILTER IS NOT BELT AND BRACES      │
 * │                                                                          │
 * │ `conversation_members_update` admits two cases: your own row, or any row  │
 * │ in a room you administer. An UPDATE filtered only by `conversation_id`    │
 * │ therefore does the right thing for an ordinary member and, for a room     │
 * │ administrator, silently stamps EVERY member's `last_read_at` — clearing   │
 * │ the whole room's unread counts and falsely ticking their read receipts    │
 * │ because one admin scrolled to the bottom.                                │
 * │                                                                          │
 * │ The policy cannot catch that: every row it touched was a row it was       │
 * │ allowed to touch. The scoping has to be here.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * NEVER BACKWARDS. Two tabs on one account settle in whichever order their
 * requests land, and a stale one writing an older timestamp would resurrect
 * unread counts somebody has already cleared. The `lt` filter makes that case a
 * no-op rather than a regression.
 */
export async function markRead(
  supabase: SupabaseClient,
  conversationId: string,
  profileId: string,
  at?: string
): Promise<void> {
  const stamp = at ?? new Date().toISOString()
  await supabase
    .from('conversation_members')
    .update({ last_read_at: stamp })
    .eq('conversation_id', conversationId)
    .eq('profile_id', profileId)
    .or(`last_read_at.is.null,last_read_at.lt.${stamp}`)
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

/**
 * Tell the room's other members that something was said.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A MESSAGE IS A PUSH, NOT A NOTIFICATION ROW                              │
 * │                                                                          │
 * │ Every other event in this product goes through `notifyEmployee`, which    │
 * │ writes a durable `notifications` row and then delivers it. That is right  │
 * │ for a decided timesheet and wrong for a chat message, by two orders of    │
 * │ magnitude: a single busy afternoon in one group is several hundred rows    │
 * │ per member, and the bell — which is where people look for the rejected     │
 * │ timesheet — becomes a transcript of the day's small talk. The important    │
 * │ notices would still be in there, three hundred rows down.                 │
 * │                                                                          │
 * │ Messaging already HAS a durable in-app surface, and it is a better one:   │
 * │ the unread count on the conversation, derived from `last_read_at`, which   │
 * │ clears itself when the thread is read and cannot drift out of step with    │
 * │ it. So this sends the push and writes nothing. That is what WhatsApp and   │
 * │ Slack do, and for the same reason.                                       │
 * │                                                                          │
 * │ Being ADDED to a conversation is the opposite case — rare, durable, and    │
 * │ the only way somebody learns a room exists — so THAT one does write a     │
 * │ row (see the members route), which is why `message.received` is in the    │
 * │ catalog at all.                                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * WHO GETS ONE. Everybody in the conversation except the sender and except
 * anybody who muted it. A MENTION OVERRIDES THE MUTE, because "tell me when I
 * am named" is precisely what people mean by muting a busy room rather than
 * leaving it.
 *
 * WHAT IT SAYS. For a direct message the sender's name is the title, which is
 * the whole of what the reader needs. For a room the room's name is the title
 * and the sender opens the body, the way every other messaging product does it,
 * because "New message" does not help anybody decide whether to look.
 *
 * THE TAG IS THE CONVERSATION. Twelve messages in one room while somebody is at
 * lunch replace each other into a single badge instead of stacking into twelve
 * alerts — the one behaviour that separates a usable chat notification from a
 * reason to turn notifications off.
 *
 * The roster and the recipients' roles are read with the service role: an
 * employee cannot enumerate another room's membership through RLS, and this is
 * the same narrow fallback `notifyOrgAdmins` makes. Pinned to the conversation
 * and to the session's tenant, and it never throws — a message that delivered
 * but failed to notify is still a message that delivered.
 */
export async function notifyNewMessage(
  _supabase: SupabaseClient,
  ctx: AppContext & { tenantId: string },
  args: {
    conversationId: string
    conversationKind: ConversationKind
    conversationName: string | null
    body: string | null
    kind: MessageKind
    mentions: string[]
  }
): Promise<void> {
  /*
   * AFTER THE RESPONSE, not before it — the same trade `raiseNotification`
   * makes, and it matters more here than anywhere else in the product.
   *
   * The fan-out is a roster read, a roles read, and one HTTPS request per
   * registered device. On the send path that is the slowest thing attached to
   * pressing Enter, and nothing about it changes the answer: the message is
   * already written, and `notifyNewMessage` cannot fail in a way the sender
   * should hear about. Holding the response for it would make every message in
   * a twenty-person room feel like a form submission.
   *
   * Outside a request scope — a script, a test — `after()` throws, and the
   * fan-out is simply awaited instead.
   */
  try {
    after(() => fanOutMessagePush(ctx, args))
    return
  } catch {
    await fanOutMessagePush(ctx, args)
  }
}

async function fanOutMessagePush(
  ctx: AppContext & { tenantId: string },
  args: {
    conversationId: string
    conversationKind: ConversationKind
    conversationName: string | null
    body: string | null
    kind: MessageKind
    mentions: string[]
  }
): Promise<void> {
  try {
    const admin = createAdminClient()
    const tenantId = assertTenantScope(ctx.tenantId)

    const { data, error } = await admin
      .from('conversation_members')
      .select('profile_id, muted')
      .eq('conversation_id', args.conversationId)
      .eq('tenant_id', tenantId)
      .limit(500)

    if (error) {
      console.error('[messaging] could not list recipients', error.message)
      return
    }

    const mentioned = new Set(args.mentions)
    const recipients = ((data ?? []) as Array<{ profile_id: string; muted: boolean }>)
      .filter((row) => row.profile_id !== ctx.userId)
      .filter((row) => !row.muted || mentioned.has(row.profile_id))
      .map((row) => row.profile_id)

    if (!recipients.length) return

    /*
     * Which portal each recipient's click should land in. The same conversation
     * lives at `/org/messages/<id>` for an administrator and
     * `/employee/messages/<id>` for everyone else, and sending either to the
     * other's URL produces a redirect to their dashboard — losing the thread
     * they tapped, which is the only thing the push was for.
     */
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, role')
      .eq('tenant_id', tenantId)
      .in('id', recipients)

    const roleById = new Map(
      ((profiles ?? []) as Array<{ id: string; role: UserRole }>).map((row) => [row.id, row.role])
    )

    const sender = displayName(ctx)
    const preview = previewFor(args.body, args.kind)
    const title =
      args.conversationKind === 'direct' ? sender : args.conversationName || 'Group message'
    const body = args.conversationKind === 'direct' ? preview : `${sender}: ${preview}`

    // Grouped by destination, so one push call covers everybody who lands in
    // the same portal instead of one call per person.
    const byPath = new Map<string, string[]>()
    for (const recipientId of recipients) {
      const path = cardPathFor(
        'message.received',
        roleById.get(recipientId) ?? 'employee',
        args.conversationId
      )
      byPath.set(path, [...(byPath.get(path) ?? []), recipientId])
    }

    await Promise.all(
      Array.from(byPath.entries()).map(([url, userIds]) =>
        sendPushToUsers(tenantId, userIds, {
          title,
          body,
          url,
          tag: `conversation:${args.conversationId}`,
        })
      )
    )

    /*
     * A mention is louder, so it goes out again with its own tag.
     *
     * A separate push rather than a different title on the first one: the tag
     * above collapses a room's messages into one badge, which is exactly what
     * should NOT happen to "you were named" — that one has to survive the
     * eleven messages that follow it.
     */
    const mentionedRecipients = recipients.filter((recipientId) => mentioned.has(recipientId))
    if (mentionedRecipients.length) {
      await Promise.all(
        mentionedRecipients.map((recipientId) =>
          sendPushToUsers(tenantId, [recipientId], {
            title: `${sender} mentioned you`,
            body: args.conversationKind === 'direct' ? preview : `${title} · ${preview}`,
            url: cardPathFor(
              'message.received',
              roleById.get(recipientId) ?? 'employee',
              args.conversationId
            ),
            tag: `mention:${args.conversationId}:${Date.now()}`,
          })
        )
      )
    }
  } catch (err) {
    console.error('[messaging] notification fan-out failed', err)
  }
}

function previewFor(body: string | null, kind: MessageKind): string {
  if (body && body.trim()) return truncate(body.trim(), 140)
  if (kind === 'image') return 'Sent a photo'
  if (kind === 'voice') return 'Sent a voice message'
  if (kind === 'file') return 'Sent an attachment'
  return 'Sent a message'
}
