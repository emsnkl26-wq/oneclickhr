import 'server-only'

/**
 * Everything a card shows once it is OPENED: the discussion, the checklist, the
 * history, the watchers.
 *
 * Kept out of `loadBoard` on purpose. A board with two hundred cards would
 * otherwise ship two hundred comment threads to draw two hundred badges. This
 * loads for exactly one task, when somebody asks for it.
 *
 * Runs on the caller's RLS-scoped client, so "can this person see this task"
 * is answered by the policies rather than re-implemented here: a task id from
 * another tenant simply resolves to nothing, and the caller gets a 404 that
 * does not tell them whether the id was real.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskActivityKind, UserRole } from '@/types/db'

export interface TaskCommentNode {
  id: string
  parent_id: string | null
  author_id: string | null
  author_name: string | null
  author_role: UserRole
  body: string
  edited_at: string | null
  deleted_at: string | null
  created_at: string
  photo_url: string | null
  replies: TaskCommentNode[]
}

export interface TaskChecklistRow {
  id: string
  content: string
  is_done: boolean
  position: number
  done_at: string | null
}

export interface TaskActivityRow {
  id: string
  actor_id: string | null
  actor_name: string | null
  kind: TaskActivityKind
  meta: Record<string, unknown>
  created_at: string
}

export interface TaskDetail {
  id: string
  comments: TaskCommentNode[]
  checklist: TaskChecklistRow[]
  activity: TaskActivityRow[]
  watcherIds: string[]
}

/** Newest history first, and only as far back as anyone scrolls. */
const ACTIVITY_LIMIT = 60

export async function loadTaskDetail(
  supabase: SupabaseClient,
  taskId: string
): Promise<TaskDetail | null> {
  const { data: task } = await supabase.from('tasks').select('id').eq('id', taskId).maybeSingle()
  if (!task) return null

  const [{ data: comments }, { data: checklist }, { data: activity }, { data: watchers }] =
    await Promise.all([
      supabase
        .from('task_comments')
        .select(
          'id, parent_id, author_id, author_name, author_role, body, edited_at, deleted_at, created_at'
        )
        .eq('task_id', taskId)
        .order('created_at'),
      supabase
        .from('task_checklist_items')
        .select('id, content, is_done, position, done_at')
        .eq('task_id', taskId)
        .order('position'),
      supabase
        .from('task_activity')
        .select('id, actor_id, actor_name, kind, meta, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
        .limit(ACTIVITY_LIMIT),
      supabase.from('task_watchers').select('profile_id').eq('task_id', taskId),
    ])

  // Current avatars for the people in the thread, in one query rather than a
  // join per comment. The NAME still comes from the comment's own snapshot —
  // this only supplies a face, and a missing one falls back to initials.
  const authorIds = Array.from(
    new Set((comments ?? []).map((c) => c.author_id).filter((id): id is string => !!id))
  )

  const photoById = new Map<string, string | null>()
  if (authorIds.length) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, photo_url')
      .in('id', authorIds)
    for (const p of profiles ?? []) photoById.set(p.id, p.photo_url)
  }

  return {
    id: taskId,
    comments: buildThread(comments ?? [], photoById),
    checklist: (checklist ?? []).map((c) => ({ ...c, position: Number(c.position) })),
    activity: (activity ?? []) as TaskActivityRow[],
    watcherIds: (watchers ?? []).map((w) => w.profile_id),
  }
}

/**
 * Flat rows → root comments each carrying their replies, oldest first.
 *
 * A DELETED root is kept as a tombstone when it still has visible replies. The
 * alternative — dropping it — silently re-parents the answers under nothing,
 * and a reader is left with agreement to a question that is no longer there.
 * A deleted root with no replies left is dropped entirely.
 */
function buildThread(
  rows: Array<Omit<TaskCommentNode, 'replies' | 'photo_url'>>,
  photoById: Map<string, string | null>
): TaskCommentNode[] {
  const roots: TaskCommentNode[] = []
  const byId = new Map<string, TaskCommentNode>()

  for (const row of rows) {
    if (row.parent_id) continue
    const node: TaskCommentNode = {
      ...row,
      photo_url: row.author_id ? photoById.get(row.author_id) ?? null : null,
      replies: [],
    }
    byId.set(node.id, node)
    roots.push(node)
  }

  for (const row of rows) {
    if (!row.parent_id) continue
    if (row.deleted_at) continue
    const parent = byId.get(row.parent_id)
    // A reply whose parent is missing entirely (a hard delete cascaded) has
    // nowhere to go and is not shown.
    if (!parent) continue
    parent.replies.push({
      ...row,
      photo_url: row.author_id ? photoById.get(row.author_id) ?? null : null,
      replies: [],
    })
  }

  return roots.filter((node) => !node.deleted_at || node.replies.length > 0)
}
