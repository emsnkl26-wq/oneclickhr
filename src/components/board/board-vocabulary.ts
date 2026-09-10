/**
 * The words and colours the task UI agrees on.
 *
 * One file rather than a constant per component, because a status that reads
 * "In review" on a card and "Review" in a filter is a status people believe are
 * two different things.
 */
import type { TaskPriority, TaskStatus } from '@/types/db'

export const STATUS_ORDER: TaskStatus[] = [
  'todo', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled',
]

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
}

/** Ring/text classes for a status pill. Kept close to `StatusChip`'s palette. */
export const STATUS_CLASS: Record<TaskStatus, string> = {
  todo: 'bg-page text-ink-muted ring-line',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  blocked: 'bg-red-50 text-red-700 ring-red-200',
  in_review: 'bg-purple-50 text-purple-700 ring-purple-200',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  cancelled: 'bg-page text-ink-muted ring-line line-through',
}

export const PRIORITY_ORDER: TaskPriority[] = ['urgent', 'high', 'medium', 'low']

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

/** The stripe down the left edge of a card. Priority is the at-a-glance signal. */
export const PRIORITY_STRIPE: Record<TaskPriority, string> = {
  low: 'bg-slate-300',
  medium: 'bg-blue-400',
  high: 'bg-amber-500',
  urgent: 'bg-red-500',
}

/** Highest first, so "sort by priority" means what a reader expects. */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0, high: 1, medium: 2, low: 3,
}

export const DEFAULT_COLUMN_COLOR = '#64748B'

/**
 * A card is closed when its status says so — never because of the column it is
 * in. A team may keep a "Done" column they clear weekly and a "Cancelled" one
 * they never look at; what makes the work finished is the status.
 */
export function isClosed(status: TaskStatus): boolean {
  return status === 'done' || status === 'cancelled'
}

/**
 * Due-date urgency, as the card renders it.
 *
 * Compared at DAY resolution against the viewer's own local midnight: a task
 * due today is not overdue at 4pm, and one due yesterday is overdue at 00:01.
 * Closed cards are never overdue — chasing a completed task is noise.
 */
export type DueTone = 'none' | 'later' | 'soon' | 'today' | 'overdue'

export function dueTone(due: string | null, status: TaskStatus): DueTone {
  if (!due || isClosed(status)) return 'none'

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // `due` is a bare ISO date. Splitting it beats `new Date(due)`, which parses
  // it as UTC midnight and lands on the previous day for anyone west of it.
  const [y, m, d] = due.split('-').map(Number)
  if (!y || !m || !d) return 'none'
  const target = new Date(y, m - 1, d)

  const days = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 2) return 'soon'
  return 'later'
}

export const DUE_CLASS: Record<DueTone, string> = {
  none: 'text-ink-muted',
  later: 'text-ink-muted',
  soon: 'text-amber-600 font-medium',
  today: 'text-amber-700 font-semibold',
  overdue: 'text-danger font-semibold',
}

export function formatDueDate(due: string): string {
  const [y, m, d] = due.split('-').map(Number)
  if (!y || !m || !d) return due
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "3 minutes ago" / "12 Mar" — relative while it is still news, then a date. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`
  if (seconds < 604_800) return `${Math.round(seconds / 86_400)}d ago`

  return new Date(then).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * Midpoint between neighbours, so a drop rewrites ONE row.
 *
 * Doubles as the column reorder maths. The 1000-unit gap at either end is what
 * keeps repeated "drop at the top" moves from converging on the same number.
 */
export function positionBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 1000
  if (before === undefined) return after! - 1000
  if (after === undefined) return before + 1000
  return (before + after) / 2
}
