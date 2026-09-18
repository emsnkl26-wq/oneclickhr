import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listBoards } from '@/lib/board-data'
import { BoardList } from '@/components/board/board-list'

export const metadata: Metadata = { title: 'Task boards' }
export const dynamic = 'force-dynamic'

export default async function OrgBoardsPage() {
  await requireOrg()
  const supabase = await createSupabaseServerClient()
  const { boards, people, error } = await listBoards(supabase)

  return (
    <BoardList
      boards={boards}
      people={people}
      loadFailed={error}
      canManage
      basePath="/org/board"
      title="Task boards"
      description="One board per team or project. Employees see only the boards they are on."
    />
  )
}
