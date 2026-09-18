import 'server-only'

/**
 * Board-level writes shared by the board routes: the form's schema, seeding a
 * new board's stages, and keeping a roster equal to a list.
 *
 * Like `task-writes.ts`, every function takes the CALLER'S client, so a write a
 * policy refuses is refused here too.
 */
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { BOARD_COLORS } from '@/components/board/board-colors'

export const boardSchema = z.object({
  name: z.string().trim().min(1, 'Give the board a name').max(100),
  description: z.string().trim().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a colour').default(BOARD_COLORS[0]),
})

/** What every tenant's board was provisioned with, as 030's backfill shaped it. */
const DEFAULT_COLUMNS: Array<Record<string, unknown>> = [
  { name: 'To Do',       position: 0, color: '#64748B', applies_status: null,          is_backlog: true },
  { name: 'In Progress', position: 1, color: '#2563EB', applies_status: 'in_progress', is_backlog: false },
  { name: 'Done',        position: 2, color: '#16A34A', applies_status: 'done',        is_backlog: false },
]

/**
 * Give a new board its stages.
 *
 * Copied from the tenant's OLDEST other board, so whatever stages the team has
 * settled on (names, colours, WIP limits, the status each applies, which one is
 * the backlog) carry over exactly. Falls back to the provisioning defaults for
 * a tenant that somehow has no other board.
 */
export async function seedBoardColumns(
  supabase: SupabaseClient,
  args: { boardId: string; tenantId: string }
): Promise<boolean> {
  const { data: template } = await supabase
    .from('boards')
    .select('id')
    .neq('id', args.boardId)
    .order('created_at')
    .limit(1)
    .maybeSingle()

  let columns = DEFAULT_COLUMNS
  if (template) {
    const { data } = await supabase
      .from('board_columns')
      .select('name, position, color, wip_limit, applies_status, is_backlog')
      .eq('board_id', template.id)
      .order('position')
    if (data?.length) columns = data
  }

  const { error } = await supabase.from('board_columns').insert(
    columns.map((c) => ({ ...c, board_id: args.boardId, tenant_id: args.tenantId }))
  )
  if (error) console.error('[board] seeding columns failed', error.message)
  return !error
}

/**
 * Make a board's roster equal to `desired`.
 *
 * Only active profiles the caller can see survive (RLS scopes the lookup to
 * the tenant). Errors are returned, never swallowed — see the assignee bug
 * this file's sibling had.
 */
export async function syncBoardMembers(
  supabase: SupabaseClient,
  args: { boardId: string; tenantId: string; actorId: string; desired: string[] }
): Promise<{ added: string[]; removed: string[]; error: string | null }> {
  const unique = Array.from(new Set(args.desired))
  const { data: valid } = unique.length
    ? await supabase.from('profiles').select('id').in('id', unique).eq('is_active', true)
    : { data: [] as Array<{ id: string }> }
  const after = new Set((valid ?? []).map((p) => p.id))

  const { data: current } = await supabase
    .from('board_members')
    .select('profile_id')
    .eq('board_id', args.boardId)
  const before = new Set((current ?? []).map((r) => r.profile_id))

  const added = Array.from(after).filter((id) => !before.has(id))
  const removed = Array.from(before).filter((id) => !after.has(id))
  let error: string | null = null

  if (removed.length) {
    const res = await supabase
      .from('board_members')
      .delete()
      .eq('board_id', args.boardId)
      .in('profile_id', removed)
    if (res.error) error = res.error.message
  }

  if (added.length) {
    const res = await supabase.from('board_members').insert(
      added.map((profile_id) => ({
        board_id: args.boardId,
        profile_id,
        tenant_id: args.tenantId,
        added_by: args.actorId,
      }))
    )
    if (res.error) error = res.error.message
  }

  return { added: error ? [] : added, removed: error ? [] : removed, error }
}
