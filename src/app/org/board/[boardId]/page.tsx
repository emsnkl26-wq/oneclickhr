import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadBoard } from '@/lib/board-data'
import { uuidSchema } from '@/lib/api'
import { BoardWorkspace } from '@/components/board/board-workspace'

export const metadata: Metadata = { title: 'Task board' }
export const dynamic = 'force-dynamic'

export default async function OrgBoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const ctx = await requireOrg()
  const parsed = uuidSchema.safeParse((await params).boardId)
  if (!parsed.success) notFound()

  const supabase = await createSupabaseServerClient()
  const board = await loadBoard(supabase, { boardId: parsed.data })
  if (!board.boardId) notFound()

  return (
    <BoardWorkspace
      // Remount per board, so one board's local card state never bleeds into
      // the next one opened.
      key={board.boardId}
      board={board}
      tenantId={ctx.tenantId}
      currentUserId={ctx.userId}
      canManage
      backHref="/org/board"
    />
  )
}
