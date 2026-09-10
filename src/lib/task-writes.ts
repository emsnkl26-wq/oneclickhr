import 'server-only'

/**
 * The parts of a task write that more than one route performs.
 *
 * Assignees and labels are join tables, and "make the set equal to this list"
 * is the same three steps every time: work out what is genuinely new, what is
 * genuinely gone, and touch only those. Doing it as delete-all-then-insert would
 * be shorter and would fire the activity triggers on every save, filling a
 * card's history with "assigned Priya / unassigned Priya" pairs that record
 * nothing that happened.
 *
 * Every function here takes the CALLER'S client. None of them use the admin
 * client, so a write an RLS policy would refuse is refused here too — there is
 * no path through this file that escalates.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyEmployee } from '@/lib/notify'

/** The ids that are really members of this tenant, in the order given. */
export async function resolveMembers(
  supabase: SupabaseClient,
  ids: string[]
): Promise<string[]> {
  if (!ids.length) return []
  // RLS scopes this select to the caller's tenant, so anything that survives is
  // legitimately assignable. No tenant filter is needed — or wanted, since one
  // written by hand is one that can be forgotten.
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .in('id', Array.from(new Set(ids)))
    .eq('is_active', true)

  return (data ?? []).map((row) => row.id)
}

interface SyncResult {
  added: string[]
  removed: string[]
}

/**
 * Make a task's assignee set equal to `desired`.
 *
 * Returns who was actually added and removed, so the caller can notify exactly
 * the people whose workload changed.
 */
export async function syncAssignees(
  supabase: SupabaseClient,
  args: { taskId: string; tenantId: string; desired: string[] }
): Promise<SyncResult> {
  const valid = await resolveMembers(supabase, args.desired)

  const { data: current } = await supabase
    .from('task_assignees')
    .select('profile_id')
    .eq('task_id', args.taskId)

  const before = new Set((current ?? []).map((r) => r.profile_id))
  const after = new Set(valid)

  const added = valid.filter((id) => !before.has(id))
  const removed = Array.from(before).filter((id) => !after.has(id))

  if (removed.length) {
    await supabase
      .from('task_assignees')
      .delete()
      .eq('task_id', args.taskId)
      .in('profile_id', removed)
  }

  if (added.length) {
    const { error } = await supabase.from('task_assignees').insert(
      added.map((profile_id) => ({
        task_id: args.taskId,
        profile_id,
        tenant_id: args.tenantId,
      }))
    )
    // A refused assignment must not fail the save that carried it: the task
    // itself is already written, and reporting a 500 here would send the user
    // back to a form whose work has in fact been saved.
    if (error) console.error('[tasks] assignment failed', error.message)
  }

  return { added, removed }
}

/** Same contract as `syncAssignees`, for the label links. */
export async function syncLabels(
  supabase: SupabaseClient,
  args: { taskId: string; tenantId: string; boardId: string; desired: string[] }
): Promise<void> {
  const unique = Array.from(new Set(args.desired))

  // Labels are board-scoped. A label id from another board is a bug or an
  // attempt; either way it is dropped rather than linked.
  const { data: valid } = unique.length
    ? await supabase
        .from('task_labels')
        .select('id')
        .in('id', unique)
        .eq('board_id', args.boardId)
    : { data: [] as Array<{ id: string }> }

  const desired = new Set((valid ?? []).map((l) => l.id))

  const { data: current } = await supabase
    .from('task_label_links')
    .select('label_id')
    .eq('task_id', args.taskId)

  const before = new Set((current ?? []).map((r) => r.label_id))

  const added = Array.from(desired).filter((id) => !before.has(id))
  const removed = Array.from(before).filter((id) => !desired.has(id))

  if (removed.length) {
    await supabase
      .from('task_label_links')
      .delete()
      .eq('task_id', args.taskId)
      .in('label_id', removed)
  }

  if (added.length) {
    const { error } = await supabase.from('task_label_links').insert(
      added.map((label_id) => ({
        task_id: args.taskId,
        label_id,
        tenant_id: args.tenantId,
      }))
    )
    if (error) console.error('[tasks] labelling failed', error.message)
  }
}

/**
 * Tell people a card landed on them.
 *
 * Never the actor: assigning yourself something and being told about it is
 * noise, and it is the single most common way a notification feed loses the
 * user's trust.
 */
export async function notifyAssigned(
  supabase: SupabaseClient,
  args: {
    tenantId: string
    actorId: string
    profileIds: string[]
    taskTitle: string
    reference?: number | null
  }
): Promise<void> {
  const targets = args.profileIds.filter((id) => id !== args.actorId)
  if (!targets.length) return

  const label = args.reference ? `#${args.reference} ${args.taskTitle}` : args.taskTitle

  await Promise.all(
    targets.map((employeeId) =>
      notifyEmployee(supabase, {
        tenantId: args.tenantId,
        employeeId,
        title: 'A task was assigned to you',
        description: label,
        createdBy: args.actorId,
      })
    )
  )
}

/**
 * Tell the people following a card that something was said on it.
 *
 * Watchers, minus the person who said it. The watcher list is maintained by
 * trigger (assignment, authorship and creation all subscribe you), so this
 * reaches the people with a stake in the card without anyone having curated a
 * list by hand.
 */
export async function notifyCommented(
  supabase: SupabaseClient,
  args: {
    tenantId: string
    actorId: string
    actorName: string
    taskId: string
    taskTitle: string
    body: string
  }
): Promise<void> {
  const { data: watchers } = await supabase
    .from('task_watchers')
    .select('profile_id')
    .eq('task_id', args.taskId)

  const targets = (watchers ?? [])
    .map((w) => w.profile_id)
    .filter((id) => id !== args.actorId)

  if (!targets.length) return

  // A preview, not the comment: a notification row is read by a bell that has
  // one line to work with, and the thread is one click away.
  const preview = args.body.length > 140 ? `${args.body.slice(0, 139)}…` : args.body

  await Promise.all(
    targets.map((employeeId) =>
      notifyEmployee(supabase, {
        tenantId: args.tenantId,
        employeeId,
        title: `${args.actorName} commented on ${args.taskTitle}`,
        description: preview,
        createdBy: args.actorId,
      })
    )
  )
}

/**
 * Exactly one backlog column per board.
 *
 * Enforced by clearing the others rather than by a partial unique index: the
 * flag MOVES, and an index would turn moving it into a two-statement dance that
 * fails halfway if the new column is written before the old one is cleared.
 * Failing to clear leaves two columns claiming the flag, which the loader
 * resolves by taking the first — untidy, never broken.
 */
export async function clearOtherBacklogs(
  supabase: SupabaseClient,
  boardId: string,
  keepId: string
): Promise<void> {
  const { error } = await supabase
    .from('board_columns')
    .update({ is_backlog: false })
    .eq('board_id', boardId)
    .neq('id', keepId)
    .eq('is_backlog', true)

  if (error) console.error('[board] could not clear the previous backlog', error.message)
}

/** The bottom of a column, with a gap so the next insert needs no renumber. */
export async function nextPositionInColumn(
  supabase: SupabaseClient,
  table: 'tasks' | 'board_columns' | 'task_checklist_items',
  filter: { column: string; value: string }
): Promise<number> {
  const { data } = await supabase
    .from(table)
    .select('position')
    .eq(filter.column, filter.value)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  return Number(data?.position ?? 0) + 1000
}
