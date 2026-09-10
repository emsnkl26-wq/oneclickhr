'use client'

/**
 * The task workspace: header, filters, the board (or the list), and every
 * dialog that hangs off them.
 *
 * SHARED BY BOTH ROLES. The org's page and the employee's "my tasks" page
 * render this same component with different flags — there is no employee copy
 * of the board to drift out of step. What differs is what is OFFERED:
 *
 *   canManage  — org. Columns, labels, deleting anyone's card.
 *   everyone   — creating a task, commenting, and moving the cards the
 *                `tasks_update` policy already allows them to move.
 *
 * Both are cosmetic. Every write is decided again by a policy; this only avoids
 * showing a button that would come back as a 403.
 */
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, KanbanSquare, Tags, LayoutGrid, List } from 'lucide-react'
import { KanbanBoard, NoMatches } from './kanban-board'
import { BoardToolbar, EMPTY_FILTERS, matchesFilters, filterCount, type BoardFilterState } from './board-filters'
import { TaskDetailDialog } from './task-detail-dialog'
import { TaskCreateDialog, ColumnDialog, LabelManagerDialog } from './board-dialogs'
import { TaskListView } from './task-list-view'
import { useBoard } from './use-board'
import { PageHeader, EmptyState } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BoardData, BoardColumnData } from '@/lib/board-data'

type View = 'board' | 'list'

export function BoardWorkspace({
  board, tenantId, currentUserId, canManage, title, description,
}: {
  board: BoardData
  tenantId: string
  currentUserId: string
  canManage: boolean
  title?: string
  description?: string
}) {
  const router = useRouter()
  const controller = useBoard({ board, tenantId })

  const [filters, setFilters] = React.useState<BoardFilterState>(EMPTY_FILTERS)
  const [view, setView] = React.useState<View>('board')
  const [openTaskId, setOpenTaskId] = React.useState<string | null>(null)
  const [createIn, setCreateIn] = React.useState<string | null>(null)
  const [columnDialog, setColumnDialog] = React.useState<
    { open: false } | { open: true; column: BoardColumnData | null }
  >({ open: false })
  const [labelsOpen, setLabelsOpen] = React.useState(false)

  /**
   * Filtering happens against the controller's tasks, then the board is handed
   * a controller whose `tasksByColumn` reflects only the survivors. The COLUMNS
   * are never filtered out — a column that empties under a filter still has to
   * be a drop target, or filtering would quietly make half the board unusable.
   */
  const filtered = React.useMemo(() => {
    if (!filterCount(filters)) return controller
    const tasks = controller.tasks.filter((t) => matchesFilters(t, filters))
    const visible = new Set(tasks.map((t) => t.id))
    const tasksByColumn = new Map(
      Array.from(controller.tasksByColumn, ([columnId, list]) => [
        columnId,
        list.filter((t) => visible.has(t.id)),
      ])
    )
    return { ...controller, tasks, tasksByColumn }
  }, [controller, filters])

  const openTask = React.useMemo(
    () => controller.tasks.find((t) => t.id === openTaskId) ?? null,
    [controller.tasks, openTaskId]
  )

  // A card the reader had open that is deleted or archived elsewhere: close
  // rather than leave a dialog describing something no longer there.
  React.useEffect(() => {
    if (openTaskId && !openTask) setOpenTaskId(null)
  }, [openTaskId, openTask])

  const canEditOpenTask =
    !!openTask &&
    (canManage ||
      openTask.created_by === currentUserId ||
      openTask.assignees.some((a) => a.id === currentUserId))

  const hasFilters = filterCount(filters) > 0
  const nothingMatches = hasFilters && filtered.tasks.length === 0 && controller.tasks.length > 0

  if (!board.boardId) {
    return (
      <div className="space-y-6">
        <PageHeader title={title ?? board.boardName} description={description} />
        <div className="card-surface">
          <EmptyState
            icon={KanbanSquare}
            title="No board yet"
            description="A default board is created with every new workspace. If you are seeing this, ask support to re-run provisioning."
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={title ?? board.boardName}
        description={
          description ??
          'Drag cards between stages. Everyone in the workspace sees changes as they happen.'
        }
        actions={
          <>
            {canManage ? (
              <>
                <Button variant="secondary" onClick={() => setLabelsOpen(true)}>
                  <Tags />
                  Labels
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setColumnDialog({ open: true, column: null })}
                >
                  <Plus />
                  Column
                </Button>
              </>
            ) : null}
            <Button
              onClick={() =>
                setCreateIn(
                  board.columns.find((c) => c.is_backlog)?.id ?? board.columns[0]?.id ?? null
                )
              }
              disabled={!board.columns.length}
            >
              <Plus />
              Task
            </Button>
          </>
        }
      />

      <BoardToolbar
        filters={filters}
        onChange={setFilters}
        members={board.members}
        labels={board.labels}
        right={<ViewToggle view={view} onChange={setView} />}
      />

      {nothingMatches ? (
        <NoMatches onClear={() => setFilters(EMPTY_FILTERS)} />
      ) : view === 'board' ? (
        <KanbanBoard
          board={filtered}
          canManage={canManage}
          currentUserId={currentUserId}
          onOpenTask={setOpenTaskId}
          onAddTask={(columnId) => setCreateIn(columnId)}
          onEditColumn={
            canManage ? (column) => setColumnDialog({ open: true, column }) : undefined
          }
        />
      ) : (
        <TaskListView
          tasks={filtered.tasks}
          columns={board.columns}
          onOpenTask={setOpenTaskId}
        />
      )}

      <TaskCreateDialog
        board={board}
        columnId={createIn}
        onClose={() => setCreateIn(null)}
        onCreated={() => {
          setCreateIn(null)
          router.refresh()
        }}
      />

      <ColumnDialog
        boardId={board.boardId}
        column={columnDialog.open ? columnDialog.column : null}
        open={columnDialog.open}
        columns={board.columns}
        onClose={() => setColumnDialog({ open: false })}
        onSaved={() => {
          setColumnDialog({ open: false })
          router.refresh()
        }}
      />

      <LabelManagerDialog
        boardId={board.boardId}
        labels={board.labels}
        open={labelsOpen}
        onClose={() => setLabelsOpen(false)}
        onSaved={() => router.refresh()}
      />

      <TaskDetailDialog
        task={openTask}
        board={board}
        open={!!openTask}
        canEdit={canEditOpenTask}
        canModerate={canManage}
        currentUserId={currentUserId}
        onClose={() => setOpenTaskId(null)}
        onPatch={controller.patchTask}
        saving={openTask ? controller.savingTaskIds.has(openTask.id) : false}
        onDelete={controller.deleteTask}
        onArchive={controller.archiveTask}
      />
    </div>
  )
}

function ViewToggle({ view, onChange }: { view: View; onChange: (next: View) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-card p-0.5" role="group" aria-label="View">
      {([
        { value: 'board' as const, icon: LayoutGrid, label: 'Board' },
        { value: 'list' as const, icon: List, label: 'List' },
      ]).map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={view === value}
          className={cn(
            'focus-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition',
            view === value ? 'bg-page text-ink' : 'text-ink-muted hover:text-ink'
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}
