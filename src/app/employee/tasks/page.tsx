import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listBoards } from '@/lib/board-data'
import { BoardList } from '@/components/board/board-list'

export const metadata: Metadata = { title: 'My tasks' }
export const dynamic = 'force-dynamic'

/**
 * The boards this employee is on. Nothing here filters by membership — the
 * `boards_select` policy (038) already returns only those boards.
 */
export default async function EmployeeTasksPage() {
  await requireEmployee()
  const supabase = await createSupabaseServerClient()
  const { boards, error } = await listBoards(supabase)

  return (
    <BoardList
      boards={boards}
      people={[]}
      loadFailed={error}
      canManage={false}
      basePath="/employee/tasks"
      title="My boards"
      description="The task boards you are a member of. Open one to see and update its cards."
    />
  )
}
