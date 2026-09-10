import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadBoard } from '@/lib/board-data'
import { BoardWorkspace } from '@/components/board/board-workspace'

export const metadata: Metadata = { title: 'Task board' }
export const dynamic = 'force-dynamic'

export default async function OrgBoardPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const board = await loadBoard(supabase)

  return (
    <BoardWorkspace
      board={board}
      tenantId={ctx.tenantId}
      currentUserId={ctx.userId}
      canManage
    />
  )
}
