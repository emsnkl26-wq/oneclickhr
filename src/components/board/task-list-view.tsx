'use client'

/**
 * The board as a list.
 *
 * WHY IT EXISTS. A board answers "where is everything" and is very bad at
 * "what is late" — the cards that matter are scattered across five columns and
 * sorted by hand. The list answers the second question: one sortable table, due
 * date first, and every card visible at once without horizontal scrolling.
 *
 * It is READ-ONLY on purpose. Editing here would mean a second set of inline
 * controls to keep in step with the card's own, and the row already opens the
 * card, which is where every edit already works.
 *
 * Sorting is client-side over rows the board has already loaded — the same
 * reasoning as the filters, and the reason it is instant.
 */
import * as React from 'react'
import { ArrowDown, ArrowUp, CalendarDays, MessageSquare, CheckSquare } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { cn, initials } from '@/lib/utils'
import type { BoardTask, BoardColumnData } from '@/lib/board-data'
import {
  STATUS_LABEL, STATUS_CLASS, PRIORITY_LABEL, PRIORITY_RANK, PRIORITY_STRIPE,
  dueTone, DUE_CLASS, formatDueDate, isClosed,
} from './board-vocabulary'

type SortKey = 'due' | 'priority' | 'status' | 'title' | 'stage'

export function TaskListView({
  tasks, columns, onOpenTask,
}: {
  tasks: BoardTask[]
  columns: BoardColumnData[]
  onOpenTask: (taskId: string) => void
}) {
  const [sort, setSort] = React.useState<{ key: SortKey; desc: boolean }>({
    key: 'due',
    desc: false,
  })

  const stageOrder = React.useMemo(
    () => new Map(columns.map((c, index) => [c.id, index])),
    [columns]
  )

  const rows = React.useMemo(() => {
    const copy = [...tasks]
    const direction = sort.desc ? -1 : 1

    copy.sort((a, b) => {
      switch (sort.key) {
        case 'due':
          // Cards with no due date sort last in BOTH directions. They are not
          // "the least urgent"; they are unscheduled, and burying them under a
          // reversed sort hides them from the person looking for them.
          if (!a.due_date && !b.due_date) return 0
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return a.due_date.localeCompare(b.due_date) * direction
        case 'priority':
          return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * direction
        case 'status':
          return a.status.localeCompare(b.status) * direction
        case 'stage':
          return ((stageOrder.get(a.column_id) ?? 0) - (stageOrder.get(b.column_id) ?? 0)) * direction
        case 'title':
          return a.title.localeCompare(b.title) * direction
        default:
          return 0
      }
    })

    return copy
  }, [tasks, sort, stageOrder])

  function toggle(key: SortKey) {
    setSort((current) =>
      current.key === key ? { key, desc: !current.desc } : { key, desc: false }
    )
  }

  if (!tasks.length) {
    return (
      <div className="card-surface p-10 text-center text-sm text-ink-muted">
        No tasks on this board yet.
      </div>
    )
  }

  return (
    <div className="card-surface overflow-hidden">
      <div className="scrollbar-thin overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-ink-muted">
              <SortHeader label="Task" active={sort} column="title" onClick={toggle} className="w-[40%]" />
              <SortHeader label="Stage" active={sort} column="stage" onClick={toggle} />
              <SortHeader label="Status" active={sort} column="status" onClick={toggle} />
              <SortHeader label="Priority" active={sort} column="priority" onClick={toggle} />
              <SortHeader label="Due" active={sort} column="due" onClick={toggle} />
              <th scope="col" className="px-3 py-2 text-right font-semibold">People</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => {
              const tone = dueTone(task.due_date, task.status)
              const stage = columns.find((c) => c.id === task.column_id)
              return (
                <tr
                  key={task.id}
                  onClick={() => onOpenTask(task.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    onOpenTask(task.id)
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open ${task.title}`}
                  className="focus-ring cursor-pointer border-b border-line/60 transition last:border-0 hover:bg-page"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-start gap-2">
                      <span
                        className={cn('mt-1 h-4 w-1 shrink-0 rounded-full', PRIORITY_STRIPE[task.priority])}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className={cn('truncate font-medium', isClosed(task.status) && 'line-through opacity-70')}>
                          {task.reference ? (
                            <span className="tabular mr-1.5 text-xs font-normal text-ink-muted">
                              #{task.reference}
                            </span>
                          ) : null}
                          {task.title}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          {task.labels.map((label) => (
                            <span
                              key={label.id}
                              className="rounded px-1.5 text-[10px] font-semibold uppercase tracking-wide text-white"
                              style={{ backgroundColor: label.color }}
                            >
                              {label.name}
                            </span>
                          ))}
                          {task.checklist_total ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                              <CheckSquare className="size-3" aria-hidden />
                              {task.checklist_done}/{task.checklist_total}
                            </span>
                          ) : null}
                          {task.comment_count ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                              <MessageSquare className="size-3" aria-hidden />
                              {task.comment_count}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-ink-muted">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: stage?.color ?? '#64748B' }}
                        aria-hidden
                      />
                      {stage?.name ?? '—'}
                    </span>
                  </td>

                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                        STATUS_CLASS[task.status]
                      )}
                    >
                      {STATUS_LABEL[task.status]}
                    </span>
                  </td>

                  <td className="px-3 py-2.5 text-ink-muted">{PRIORITY_LABEL[task.priority]}</td>

                  <td className={cn('px-3 py-2.5', DUE_CLASS[tone])}>
                    {task.due_date ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <CalendarDays className="size-3.5" aria-hidden />
                        {formatDueDate(task.due_date)}
                      </span>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </td>

                  <td className="px-3 py-2.5">
                    <div className="flex justify-end -space-x-1.5">
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
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortHeader({
  label, column, active, onClick, className,
}: {
  label: string
  column: SortKey
  active: { key: SortKey; desc: boolean }
  onClick: (key: SortKey) => void
  className?: string
}) {
  const isActive = active.key === column
  const Icon = active.desc ? ArrowDown : ArrowUp

  return (
    <th scope="col" className={cn('px-3 py-2 font-semibold', className)}>
      <button
        type="button"
        onClick={() => onClick(column)}
        className="focus-ring inline-flex items-center gap-1 rounded uppercase tracking-wider transition hover:text-ink"
        aria-sort={isActive ? (active.desc ? 'descending' : 'ascending') : 'none'}
      >
        {label}
        {isActive ? <Icon className="size-3" aria-hidden /> : null}
      </button>
    </th>
  )
}
