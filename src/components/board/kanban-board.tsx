'use client'

/**
 * The board.
 *
 * TWO DRAG AXES, ONE DndContext. Cards move between columns and columns move
 * among themselves, and `dnd-kit` resolves both from one drop because every
 * draggable declares what it is in `data.type`. Running two contexts would mean
 * two sets of sensors competing for the same pointer, which is how a board ends
 * up dragging a column when somebody meant to grab a card.
 *
 * WHAT DECIDES A DROP. `closestCorners` against a droppable per column plus a
 * sortable per card. A drop onto a CARD means "put me where that card is"; a
 * drop onto the column's empty area means "put me at the end". Both resolve to
 * a fractional position between two neighbours, so a move rewrites ONE row —
 * see `useBoard`.
 *
 * PERMISSION IS NOT DECIDED HERE. `canMove` mirrors the `tasks_update` policy so
 * the UI does not offer a drag the database would refuse, and that is all it
 * does; the binding check is the policy. Anything this file gets wrong is a
 * cosmetic bug, never a security one.
 */
import * as React from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, useSensor, useSensors,
  closestCorners, useDroppable, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import {
  useSortable, SortableContext, verticalListSortingStrategy, horizontalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  CalendarDays, GripVertical, Plus, MessageSquare, CheckSquare, Settings2,
  AlertTriangle, Archive, ListFilter, Loader2,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { EmptyState } from '@/components/ui/patterns'
import { cn, initials } from '@/lib/utils'
import type { BoardTask, BoardColumnData } from '@/lib/board-data'
import type { BoardController } from './use-board'
import {
  STATUS_LABEL, STATUS_CLASS, PRIORITY_STRIPE, PRIORITY_LABEL, DEFAULT_COLUMN_COLOR,
  dueTone, DUE_CLASS, formatDueDate, isClosed,
} from './board-vocabulary'

export type { BoardTask, BoardColumnData } from '@/lib/board-data'

interface DragData {
  type: 'task' | 'column'
  columnId?: string
}

export function KanbanBoard({
  board, canManage, currentUserId, onOpenTask, onAddTask, onEditColumn,
}: {
  board: BoardController
  canManage: boolean
  currentUserId: string
  onOpenTask: (taskId: string) => void
  onAddTask?: (columnId: string) => void
  onEditColumn?: (column: BoardColumnData) => void
}) {
  const [dragging, setDragging] = React.useState<
    { type: 'task'; task: BoardTask } | { type: 'column'; column: BoardColumnData } | null
  >(null)

  const sensors = useSensors(
    // A small activation distance so a click on a card is a click, not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  )

  /**
   * Mirrors `tasks_update`: an org moves any card, an employee moves cards
   * assigned to them or raised by them.
   */
  const canMove = React.useCallback(
    (task: BoardTask): boolean =>
      canManage ||
      task.created_by === currentUserId ||
      task.assignees.some((a) => a.id === currentUserId),
    [canManage, currentUserId]
  )

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined

    if (data?.type === 'column') {
      const column = board.columns.find((c) => c.id === event.active.id)
      if (column) setDragging({ type: 'column', column })
      return
    }

    const task = board.tasks.find((t) => t.id === event.active.id)
    if (task && canMove(task)) setDragging({ type: 'task', task })
  }

  async function onDragEnd(event: DragEndEvent) {
    const active = dragging
    setDragging(null)

    const { over } = event
    if (!over || !active) return

    // Every draggable and every drop zone carries the column it belongs to, so
    // "where did this land" is one lookup rather than three special cases.
    const overData = over.data.current as DragData | undefined
    const targetColumn = overData?.columnId
    if (!targetColumn || !board.columns.some((c) => c.id === targetColumn)) return

    if (active.type === 'column') {
      // Dropping a column onto a CARD means the column that card lives in.
      if (targetColumn === active.column.id) return

      const to = board.columns.findIndex((c) => c.id === targetColumn)
      if (to === -1) return

      await board.moveColumn(active.column.id, to)
      return
    }

    const task = active.task
    if (!canMove(task)) return

    // Dropped ON a card: land in that card's place. Dropped on the column's
    // empty area: land at the end.
    const overTask = overData?.type === 'task' ? board.tasks.find((t) => t.id === over.id) : null
    await board.moveTask(task.id, targetColumn, overTask ? overTask.id : null)
  }

  if (!board.columns.length) {
    return (
      <EmptyState
        icon={Plus}
        title="This board has no columns"
        description="Add a column to start organising work."
      />
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      {/*
        A FIXED height, not one that grows with the tallest column: a busy
        column scrolls inside itself, so the other columns (and the drop zones
        at their ends) stay on screen instead of being pushed below the fold.
      */}
      <div className="scrollbar-thin flex h-[calc(100dvh-24rem)] min-h-[420px] items-stretch gap-4 overflow-x-auto pb-4">
        {/*
          The columns are their own sortable list, laid out horizontally. It is
          nested inside the same DndContext as the cards rather than beside it,
          which is what lets one pointer gesture resolve to either axis.
        */}
        <SortableContext
          items={board.columns.map((c) => c.id)}
          strategy={horizontalListSortingStrategy}
        >
          {board.columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              tasks={board.tasksByColumn.get(column.id) ?? []}
              canManage={canManage}
              canMove={canMove}
              savingTaskIds={board.savingTaskIds}
              onOpenTask={onOpenTask}
              onAdd={onAddTask}
              onEdit={onEditColumn}
            />
          ))}
        </SortableContext>
      </div>

      <DragOverlay>
        {dragging?.type === 'task' ? <TaskCard task={dragging.task} overlay /> : null}
        {dragging?.type === 'column' ? (
          <div className="w-[300px] rounded-xl border border-brand-200 bg-card p-3 shadow-pop">
            <p className="text-[13px] font-semibold uppercase tracking-wider text-ink-muted">
              {dragging.column.name}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

/* --------------------------------------------------------------- a column */

function Column({
  column, tasks, canManage, canMove, savingTaskIds, onOpenTask, onAdd, onEdit,
}: {
  column: BoardColumnData
  tasks: BoardTask[]
  canManage: boolean
  canMove: (task: BoardTask) => boolean
  savingTaskIds: ReadonlySet<string>
  onOpenTask: (taskId: string) => void
  onAdd?: (columnId: string) => void
  onEdit?: (column: BoardColumnData) => void
}) {
  /*
   * The card drop zone and the column's own sortable are two SEPARATE
   * registrations, and they must not share an id — dnd-kit keys everything on
   * it, and two nodes claiming `column.id` means one silently wins.
   *
   * So the sortable (for reordering columns) keeps the bare id, which is what
   * `SortableContext` matches on, and the drop zone takes a prefixed one. What
   * a drop resolves to is read from `data.columnId`, which BOTH set, along with
   * every card — so the answer never depends on which of the three the pointer
   * happened to land on.
   */
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop:${column.id}`,
    data: { type: 'column', columnId: column.id } satisfies DragData,
  })

  const {
    attributes, listeners, setNodeRef: setSortRef, transform, transition, isDragging,
  } = useSortable({
    id: column.id,
    data: { type: 'column', columnId: column.id } satisfies DragData,
    disabled: !canManage,
  })

  // WIP is counted against OPEN cards only. A column holding twenty finished
  // items is not twenty things in progress, and a limit that says otherwise is
  // one people learn to ignore.
  const open = tasks.filter((t) => !isClosed(t.status)).length
  const overLimit = column.wip_limit !== null && open > column.wip_limit
  const atLimit = column.wip_limit !== null && open === column.wip_limit

  const color = column.color ?? DEFAULT_COLUMN_COLOR

  return (
    <section
      ref={setSortRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'flex min-h-0 w-[300px] shrink-0 flex-col rounded-xl border border-line bg-page/70 transition',
        isOver && 'border-brand-200 bg-brand-50/50',
        isDragging && 'opacity-40'
      )}
    >
      <header className="flex items-center gap-2 px-3 py-3">
        {canManage ? (
          <button
            type="button"
            aria-label={`Reorder ${column.name}`}
            className="focus-ring cursor-grab touch-none rounded p-0.5 text-ink-muted/50 hover:text-ink-muted active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}

        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />

        <h3 className="flex-1 truncate text-[13px] font-semibold uppercase tracking-wider text-ink-muted">
          {column.name}
        </h3>

        <span
          className={cn(
            'tabular rounded-full px-2 py-0.5 text-xs font-medium ring-1',
            overLimit
              ? 'bg-red-50 text-red-700 ring-red-200'
              : atLimit
                ? 'bg-amber-50 text-amber-700 ring-amber-200'
                : 'bg-card text-ink-muted ring-line'
          )}
          title={
            column.wip_limit !== null
              ? `${open} in progress, limit ${column.wip_limit}`
              : `${tasks.length} ${tasks.length === 1 ? 'card' : 'cards'}`
          }
        >
          {column.wip_limit !== null ? `${open}/${column.wip_limit}` : tasks.length}
        </span>

        {canManage && onEdit ? (
          <button
            type="button"
            onClick={() => onEdit(column)}
            aria-label={`Column settings for ${column.name}`}
            className="focus-ring rounded-md p-1 text-ink-muted transition hover:bg-card hover:text-brand-600"
          >
            <Settings2 className="size-4" />
          </button>
        ) : null}

        {onAdd ? (
          <button
            type="button"
            onClick={() => onAdd(column.id)}
            aria-label={`Add a task to ${column.name}`}
            className="focus-ring rounded-md p-1 text-ink-muted transition hover:bg-card hover:text-brand-600"
          >
            <Plus className="size-4" />
          </button>
        ) : null}
      </header>

      {overLimit ? (
        <p className="mx-3 mb-2 flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          Over the {column.wip_limit}-card limit
        </p>
      ) : null}

      <div
        ref={setDropRef}
        className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3"
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTask
              key={task.id}
              task={task}
              draggable={canMove(task)}
              saving={savingTaskIds.has(task.id)}
              onOpen={onOpenTask}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-ink-muted">Nothing here yet</p>
        ) : null}
      </div>
    </section>
  )
}

/* ----------------------------------------------------------------- a card */

function SortableTask({
  task, draggable, saving, onOpen,
}: {
  task: BoardTask
  draggable: boolean
  saving: boolean
  onOpen: (taskId: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', columnId: task.column_id } satisfies DragData,
    disabled: !draggable,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
    >
      <TaskCard
        task={task}
        saving={saving}
        onOpen={onOpen}
        dragHandle={
          draggable ? (
            <button
              type="button"
              aria-label={`Move ${task.title}`}
              className="focus-ring -ml-0.5 cursor-grab touch-none rounded p-0.5 text-ink-muted/50 hover:text-ink-muted active:cursor-grabbing"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="size-4" />
            </button>
          ) : null
        }
      />
    </div>
  )
}

/**
 * The card.
 *
 * Everything on it is already loaded by `loadBoard`, so rendering two hundred
 * of these costs no queries. What it shows, in the order the eye reads it: the
 * priority stripe, the labels, the title, then the metadata row — status, due
 * date, checklist progress, comment count, faces.
 *
 * The whole card is the click target for opening it, with the drag handle and
 * nothing else opting out. A card whose only affordance is a small "open"
 * button teaches people to hunt for it.
 */
function TaskCard({
  task, overlay, saving, onOpen, dragHandle,
}: {
  task: BoardTask
  overlay?: boolean
  /** A write for this card is in flight — a move, or an edit from the dialog. */
  saving?: boolean
  onOpen?: (taskId: string) => void
  dragHandle?: React.ReactNode
}) {
  const tone = dueTone(task.due_date, task.status)
  const closed = isClosed(task.status)

  return (
    <article
      className={cn(
        'card-surface group relative overflow-hidden p-3 pl-4 transition',
        onOpen && 'cursor-pointer hover:border-brand-200 hover:shadow-sm',
        overlay && 'rotate-2 shadow-pop',
        closed && 'opacity-75'
      )}
      onClick={onOpen ? () => onOpen(task.id) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              onOpen(task.id)
            }
          : undefined
      }
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? `Open ${task.title}` : undefined}
    >
      <span
        className={cn('absolute inset-y-0 left-0 w-1', PRIORITY_STRIPE[task.priority])}
        aria-hidden
        title={`${PRIORITY_LABEL[task.priority]} priority`}
      />

      {task.labels.length ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span
              key={label.id}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
              style={{ backgroundColor: label.color }}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex items-start gap-1.5">
        {/* Stop a drag on the handle from also counting as a click on the card. */}
        {dragHandle ? (
          <span onClick={(event) => event.stopPropagation()}>{dragHandle}</span>
        ) : null}
        <p className={cn('min-w-0 flex-1 text-sm font-medium leading-snug', closed && 'line-through')}>
          {task.title}
        </p>
        {saving ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-600" aria-label="Saving" />
        ) : null}
        {task.reference ? (
          <span className="tabular shrink-0 text-[11px] font-medium text-ink-muted/70">
            #{task.reference}
          </span>
        ) : null}
      </div>

      {task.description ? (
        <p className="mt-1.5 line-clamp-2 pl-[22px] text-xs leading-relaxed text-ink-muted">
          {task.description}
        </p>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pl-[22px]">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            STATUS_CLASS[task.status]
          )}
        >
          {STATUS_LABEL[task.status]}
        </span>

        {task.due_date ? (
          <span className={cn('inline-flex items-center gap-1 text-xs', DUE_CLASS[tone])}>
            <CalendarDays className="size-3.5" aria-hidden />
            {formatDueDate(task.due_date)}
          </span>
        ) : null}

        {task.checklist_total ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs',
              task.checklist_done === task.checklist_total
                ? 'font-medium text-emerald-600'
                : 'text-ink-muted'
            )}
          >
            <CheckSquare className="size-3.5" aria-hidden />
            {task.checklist_done}/{task.checklist_total}
          </span>
        ) : null}

        {task.comment_count ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
            <MessageSquare className="size-3.5" aria-hidden />
            {task.comment_count}
          </span>
        ) : null}

        {task.archived_at ? (
          <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
            <Archive className="size-3.5" aria-hidden />
            Archived
          </span>
        ) : null}

        {task.assignees.length ? (
          <div className="ml-auto flex -space-x-1.5">
            {task.assignees.slice(0, 3).map((person) => (
              <Avatar key={person.id} className="size-6 ring-2 ring-card">
                {person.photo_url ? (
                  <AvatarImage
                    src={`/api/files/view?key=${encodeURIComponent(person.photo_url)}`}
                    alt={person.full_name ?? ''}
                  />
                ) : null}
                <AvatarFallback className="text-[9px]">
                  {initials(person.full_name, person.email)}
                </AvatarFallback>
              </Avatar>
            ))}
            {task.assignees.length > 3 ? (
              <span className="grid size-6 place-items-center rounded-full bg-page text-[9px] font-semibold text-ink-muted ring-2 ring-card">
                +{task.assignees.length - 3}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  )
}

/** Shown when every card is filtered out — distinct from an empty board. */
export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="card-surface">
      <EmptyState
        icon={ListFilter}
        title="No tasks match these filters"
        description="Nothing on this board fits what you are filtering for."
        action={
          <button
            type="button"
            onClick={onClear}
            className="focus-ring rounded-md px-3 py-1.5 text-sm font-medium text-brand-600 hover:bg-brand-50"
          >
            Clear filters
          </button>
        }
      />
    </div>
  )
}
