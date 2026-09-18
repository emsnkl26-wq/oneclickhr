import 'server-only'

/**
 * Board loading, shared by the org board page and the employee "my tasks" view.
 *
 * Every query runs on the caller's RLS-scoped client, so the same code returns
 * the whole board to an org and only the caller's tenant to an employee, with no
 * role branching here.
 *
 * SHAPE OF THE LOAD. Six queries, none of them per-card:
 *
 *   board → columns, tasks, members, labels   (four in parallel)
 *   then  → assignees, label links            (two in parallel, by task id)
 *
 * The two follow-ups need the task ids, which is the only reason they are a
 * second round. Everything a CARD renders — assignees, labels, comment count,
 * checklist progress — comes from this load; opening a card fetches its thread
 * and history, and nothing else does (see `task-detail.ts`).
 *
 * Checklist progress is the one aggregate computed here rather than stored: it
 * is two integers per card and changes far more often than it is read, so a
 * counter column would be three more triggers to keep honest for no measurable
 * gain over a single grouped select.
 *
 * ARCHIVED CARDS are excluded unless asked for. An archive that still fills the
 * board is not an archive.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TaskPriority, TaskStatus } from '@/types/db'

export interface BoardMember {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
}

export interface BoardLabel {
  id: string
  name: string
  color: string
}

export interface BoardTask {
  id: string
  column_id: string
  title: string
  description: string | null
  position: number
  priority: TaskPriority
  status: TaskStatus
  reference: number | null
  due_date: string | null
  start_date: string | null
  estimate_hours: number | null
  archived_at: string | null
  comment_count: number
  created_by: string | null
  assignees: BoardMember[]
  labels: BoardLabel[]
  checklist_total: number
  checklist_done: number
}

export interface BoardColumnData {
  id: string
  name: string
  position: number
  color: string | null
  wip_limit: number | null
  applies_status: TaskStatus | null
  is_backlog: boolean
}

export interface BoardData {
  boardId: string | null
  boardName: string
  boardDescription: string | null
  /** The board's theme colour: its card accent and page header. */
  boardColor: string
  columns: BoardColumnData[]
  tasks: BoardTask[]
  members: BoardMember[]
  labels: BoardLabel[]
}

const EMPTY: BoardData = {
  boardId: null,
  boardName: 'Team Board',
  boardDescription: null,
  boardColor: '#2563EB',
  columns: [],
  tasks: [],
  members: [],
  labels: [],
}

export async function loadBoard(
  supabase: SupabaseClient,
  options: { boardId?: string; includeArchived?: boolean } = {}
): Promise<BoardData> {
  // With an id: that board, or nothing when RLS says the caller is not on it.
  // Without: the oldest board the caller can see.
  let boardQuery = supabase
    .from('boards')
    .select('id, name, description, color')
    .order('created_at')
    .limit(1)
  if (options.boardId) boardQuery = boardQuery.eq('id', options.boardId)
  const { data: board } = await boardQuery.maybeSingle()

  if (!board) return EMPTY

  // One unbroken string literal on purpose: the Supabase types read the select
  // list at the type level, and a concatenated expression is not a literal, so
  // splitting it for width silently degrades every row below to `any`-ish.
  let taskQuery = supabase
    .from('tasks')
    .select('id, column_id, title, description, position, priority, status, reference, due_date, start_date, estimate_hours, archived_at, comment_count, created_by')
    .eq('board_id', board.id)
    .order('position')

  if (!options.includeArchived) taskQuery = taskQuery.is('archived_at', null)

  const [{ data: columns }, { data: tasks }, { data: members }, { data: labels }] =
    await Promise.all([
      supabase
        .from('board_columns')
        .select('id, name, position, color, wip_limit, applies_status, is_backlog')
        .eq('board_id', board.id)
        .order('position'),
      taskQuery,
      supabase
        .from('profiles')
        .select('id, full_name, email, photo_url')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('task_labels')
        .select('id, name, color')
        .eq('board_id', board.id)
        .order('name'),
    ])

  const taskIds = (tasks ?? []).map((t) => t.id)

  const assigneesByTask = new Map<string, BoardMember[]>()
  const labelsByTask = new Map<string, BoardLabel[]>()
  const checklistByTask = new Map<string, { total: number; done: number }>()

  if (taskIds.length) {
    const [{ data: links }, { data: labelLinks }, { data: checklist }] = await Promise.all([
      supabase.from('task_assignees').select('task_id, profile_id').in('task_id', taskIds),
      supabase.from('task_label_links').select('task_id, label_id').in('task_id', taskIds),
      supabase.from('task_checklist_items').select('task_id, is_done').in('task_id', taskIds),
    ])

    const memberById = new Map((members ?? []).map((m) => [m.id, m as BoardMember]))
    for (const link of links ?? []) {
      const person = memberById.get(link.profile_id)
      // A link to somebody deactivated since: the card keeps its history, but
      // there is nobody to render, so it is simply not shown.
      if (!person) continue
      const list = assigneesByTask.get(link.task_id) ?? []
      list.push(person)
      assigneesByTask.set(link.task_id, list)
    }

    const labelById = new Map((labels ?? []).map((l) => [l.id, l as BoardLabel]))
    for (const link of labelLinks ?? []) {
      const label = labelById.get(link.label_id)
      if (!label) continue
      const list = labelsByTask.get(link.task_id) ?? []
      list.push(label)
      labelsByTask.set(link.task_id, list)
    }

    for (const item of checklist ?? []) {
      const tally = checklistByTask.get(item.task_id) ?? { total: 0, done: 0 }
      tally.total += 1
      if (item.is_done) tally.done += 1
      checklistByTask.set(item.task_id, tally)
    }
  }

  return {
    boardId: board.id,
    boardName: board.name,
    boardDescription: board.description ?? null,
    boardColor: board.color ?? EMPTY.boardColor,
    columns: (columns ?? []).map((c) => ({
      ...c,
      position: Number(c.position),
    })) as BoardColumnData[],
    tasks: (tasks ?? []).map((task) => {
      const tally = checklistByTask.get(task.id)
      return {
        ...task,
        // `numeric` arrives as a string from PostgREST; the board sorts and
        // averages these, and doing either on strings is silently wrong.
        position: Number(task.position),
        estimate_hours: task.estimate_hours === null ? null : Number(task.estimate_hours),
        assignees: assigneesByTask.get(task.id) ?? [],
        labels: labelsByTask.get(task.id) ?? [],
        checklist_total: tally?.total ?? 0,
        checklist_done: tally?.done ?? 0,
      }
    }) as BoardTask[],
    members: (members ?? []) as BoardMember[],
    labels: (labels ?? []) as BoardLabel[],
  }
}

/* ------------------------------------------------------------- board list */

export interface BoardSummary {
  id: string
  name: string
  description: string | null
  color: string
  created_at: string
  members: BoardMember[]
  open_tasks: number
  done_tasks: number
}

/**
 * Every board the caller can see, with its roster and a task tally.
 *
 * RLS does the scoping (038): the org gets every board in its tenant, an
 * employee only boards they are a member of. Four queries, none per board.
 */
export async function listBoards(supabase: SupabaseClient): Promise<{
  boards: BoardSummary[]
  people: BoardMember[]
  error: boolean
}> {
  const [{ data: boards, error }, { data: people }] = await Promise.all([
    supabase.from('boards').select('id, name, description, color, created_at').order('created_at'),
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url, role')
      .eq('is_active', true)
      .order('full_name'),
  ])

  const ids = (boards ?? []).map((b) => b.id)
  let members: Array<{ board_id: string; profile_id: string }> = []
  let tasks: Array<{ board_id: string; status: string }> = []
  if (ids.length) {
    const [m, t] = await Promise.all([
      supabase.from('board_members').select('board_id, profile_id').in('board_id', ids),
      supabase.from('tasks').select('board_id, status').in('board_id', ids).is('archived_at', null),
    ])
    members = m.data ?? []
    tasks = t.data ?? []
  }

  const personById = new Map((people ?? []).map((p) => [p.id, p as BoardMember]))

  return {
    error: !!error,
    // Rosters are for employees; the org sees every board regardless.
    people: (people ?? [])
      .filter((p) => p.role === 'employee')
      .map((p) => ({ id: p.id, full_name: p.full_name, email: p.email, photo_url: p.photo_url })),
    boards: (boards ?? []).map((b) => {
      const onBoard = tasks.filter((t) => t.board_id === b.id)
      return {
        id: b.id,
        name: b.name,
        description: b.description ?? null,
        color: b.color ?? EMPTY.boardColor,
        created_at: b.created_at,
        members: members
          .filter((m) => m.board_id === b.id)
          .map((m) => personById.get(m.profile_id))
          .filter((p): p is BoardMember => !!p),
        open_tasks: onBoard.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length,
        done_tasks: onBoard.filter((t) => t.status === 'done').length,
      }
    }),
  }
}
