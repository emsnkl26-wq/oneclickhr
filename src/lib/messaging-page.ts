import 'server-only'

/**
 * Everything the messaging screen needs, loaded once per request.
 *
 * Both portals render the same component with the same props, so the loading
 * lives here rather than being written twice — the only thing that differs
 * between `/org/messages` and `/employee/messages` is the guard in front of
 * them and the `basePath` the links are built from.
 *
 * WHICH PROJECTS ARE OFFERED, and why it is not simply "all of them":
 *
 *   • an ORG admin may open a room for any project in the workspace
 *   • an EMPLOYEE may open one only for a project they MANAGE —
 *     `conversations_insert` says so (`app.manages_project`), and offering a
 *     project whose every attempt would 403 is worse than offering none
 *
 * A project that already HAS a room is still listed, carrying that room's id,
 * so the dialog can open it instead of failing against the one-room-per-project
 * unique index.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { listConversations, loadConversation, MESSAGE_PAGE } from '@/lib/messaging'
import type { ConversationDetail, ConversationSummary, MessagingPerson } from '@/lib/messaging-shared'
import type { OrgContext } from '@/lib/auth/guards'

export interface ProjectOption {
  id: string
  code: string
  name: string
  conversationId: string | null
  /** The project's assignees as profile ids, viewer excluded — the room's default roster. */
  memberIds: string[]
}

export interface MessagingPageData {
  conversations: ConversationSummary[]
  people: MessagingPerson[]
  projects: ProjectOption[]
  canCreateProjectRoom: boolean
}

export async function loadMessagingPage(
  supabase: SupabaseClient,
  ctx: OrgContext
): Promise<MessagingPageData> {
  const [{ conversations, people }, projects] = await Promise.all([
    listConversations(supabase, ctx),
    loadProjectOptions(supabase, ctx),
  ])

  return {
    conversations,
    people,
    projects,
    canCreateProjectRoom: projects.length > 0,
  }
}

async function loadProjectOptions(
  supabase: SupabaseClient,
  ctx: OrgContext
): Promise<ProjectOption[]> {
  /*
   * `projects_select` already narrows an employee to the projects they are on
   * or manage (010/059), so the extra `manager_id` filter is about ELIGIBILITY
   * rather than visibility: being assigned to a project does not entitle you to
   * open its room.
   */
  let query = supabase
    .from('projects')
    .select('id, code, name')
    .eq('status', 'active')
    .order('name')
    .limit(200)
  if (ctx.role !== 'org') query = query.eq('manager_id', ctx.userId)

  const { data } = await query
  const rows = (data ?? []) as Array<{ id: string; code: string; name: string }>
  if (!rows.length) return []

  const projectIds = rows.map((row) => row.id)

  /*
   * The existing room (if any) and the project's assignees, read through the
   * CALLER'S client so RLS scopes both. The assignees seed the picker, where
   * they are ticked but removable — the room no longer force-adds them, so a
   * ticked-then-unticked person stays out.
   */
  const [{ data: rooms }, { data: assignments }] = await Promise.all([
    supabase.from('conversations').select('id, project_id').in('project_id', projectIds),
    supabase.from('project_assignments').select('project_id, employee_id').in('project_id', projectIds),
  ])

  const roomByProject = new Map(
    ((rooms ?? []) as Array<{ id: string; project_id: string | null }>)
      .filter((row) => !!row.project_id)
      .map((row) => [row.project_id as string, row.id])
  )

  const membersByProject = new Map<string, string[]>()
  for (const row of (assignments ?? []) as Array<{ project_id: string; employee_id: string }>) {
    if (row.employee_id === ctx.userId) continue
    const list = membersByProject.get(row.project_id) ?? []
    if (!list.includes(row.employee_id)) list.push(row.employee_id)
    membersByProject.set(row.project_id, list)
  }

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    conversationId: roomByProject.get(row.id) ?? null,
    memberIds: membersByProject.get(row.id) ?? [],
  }))
}

/**
 * One conversation, for the route that names it.
 *
 * Returns null when the caller may not see it — RLS answers that by returning
 * no row — and the page turns that into a `notFound()`. A 404 rather than a
 * 403, deliberately: telling somebody that a conversation exists but is not
 * theirs is itself a disclosure, and in a product where a private group's
 * existence is part of what is private, the two answers have to look the same.
 */
export async function loadThread(
  supabase: SupabaseClient,
  ctx: OrgContext,
  conversationId: string
): Promise<ConversationDetail | null> {
  return loadConversation(supabase, ctx, conversationId, { limit: MESSAGE_PAGE })
}
