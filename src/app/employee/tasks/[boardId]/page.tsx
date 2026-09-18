import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadBoard } from '@/lib/board-data'
import { uuidSchema } from '@/lib/api'
import { BoardWorkspace } from '@/components/board/board-workspace'

export const metadata: Metadata = { title: 'Task board' }
export const dynamic = 'force-dynamic'

export default async function EmployeeBoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const ctx = await requireEmployee()
  const parsed = uuidSchema.safeParse((await params).boardId)
  if (!parsed.success) notFound()

  const supabase = await createSupabaseServerClient()
  // A board the employee is not on comes back empty from RLS, and is a 404.
  const board = await loadBoard(supabase, { boardId: parsed.data })
  if (!board.boardId) notFound()

  const mine = board.tasks.filter((t) => t.assignees.some((a) => a.id === ctx.userId)).length

  return (
    <BoardWorkspace
      key={board.boardId}
      board={board}
      tenantId={ctx.tenantId}
      currentUserId={ctx.userId}
      // Columns and labels are how the workspace decides to lay work out, which
      // is an org decision — the same rule the `board_columns_write` and
      // `task_labels_write` policies enforce. Everything else on this screen is
      // open to an employee: raising a task, moving the cards that are theirs,
      // and joining the discussion on any of them.
      canManage={false}
      backHref="/employee/tasks"
      description={
        mine
          ? `You can update the ${mine} ${mine === 1 ? 'card' : 'cards'} assigned to you, and comment on any of them.`
          : 'Raise a task, or comment on anything here. Cards become yours to move once they are assigned to you.'
      }
    />
  )
}
