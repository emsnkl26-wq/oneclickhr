'use client'

/**
 * The board's filter bar, and the predicate behind it.
 *
 * DELIBERATELY CLIENT-SIDE, unlike the app's `SearchField`/`FilterSelect`, which
 * put their state in the URL so the SERVER can filter an indexed query. That is
 * the right shape for a paginated table of ten thousand rows; it is the wrong
 * shape here. A board loads its cards in full — it has to, or the columns could
 * not show counts or be dragged between — so the rows are already in the
 * browser, and a round trip per keystroke would buy nothing but latency.
 *
 * The trade is that a filtered board is not linkable. That is worth stating
 * plainly rather than hiding: "show me Priya's urgent cards" is a thing people
 * do for thirty seconds, not a thing they send to someone.
 */
import * as React from 'react'
import { Search, X, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { cn, initials } from '@/lib/utils'
import type { BoardTask, BoardMember, BoardLabel } from '@/lib/board-data'
import type { TaskPriority, TaskStatus } from '@/types/db'
import {
  PRIORITY_ORDER, PRIORITY_LABEL, STATUS_ORDER, STATUS_LABEL, dueTone, isClosed,
} from './board-vocabulary'

export interface BoardFilterState {
  query: string
  assignees: string[]
  priorities: TaskPriority[]
  statuses: TaskStatus[]
  labels: string[]
  /** Cards that are late or due within two days. */
  dueSoon: boolean
  /** Hide anything already finished or abandoned. */
  hideClosed: boolean
}

export const EMPTY_FILTERS: BoardFilterState = {
  query: '',
  assignees: [],
  priorities: [],
  statuses: [],
  labels: [],
  dueSoon: false,
  hideClosed: false,
}

export function filterCount(filters: BoardFilterState): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    filters.assignees.length +
    filters.priorities.length +
    filters.statuses.length +
    filters.labels.length +
    (filters.dueSoon ? 1 : 0) +
    (filters.hideClosed ? 1 : 0)
  )
}

/**
 * Does this card survive the filter?
 *
 * Every facet is AND-ed with the others and OR-ed within itself: two assignees
 * selected means "either of them", but an assignee AND a priority means both
 * must hold. That is what every board product does, and more importantly it is
 * what people assume without being told.
 *
 * `unassigned` is a real value in the assignee facet rather than a separate
 * toggle — "who is this on" and "nobody" are the same question.
 */
export function matchesFilters(task: BoardTask, filters: BoardFilterState): boolean {
  const query = filters.query.trim().toLowerCase()
  if (query) {
    const haystack = [
      task.title,
      task.description ?? '',
      task.reference ? `#${task.reference}` : '',
      ...task.labels.map((l) => l.name),
      ...task.assignees.map((a) => a.full_name ?? a.email ?? ''),
    ]
      .join(' ')
      .toLowerCase()
    if (!haystack.includes(query)) return false
  }

  if (filters.assignees.length) {
    const ids = new Set(task.assignees.map((a) => a.id))
    const wantsUnassigned = filters.assignees.includes('unassigned')
    const hit =
      (wantsUnassigned && ids.size === 0) ||
      filters.assignees.some((id) => id !== 'unassigned' && ids.has(id))
    if (!hit) return false
  }

  if (filters.priorities.length && !filters.priorities.includes(task.priority)) return false
  if (filters.statuses.length && !filters.statuses.includes(task.status)) return false

  if (filters.labels.length) {
    const ids = new Set(task.labels.map((l) => l.id))
    if (!filters.labels.some((id) => ids.has(id))) return false
  }

  if (filters.dueSoon) {
    const tone = dueTone(task.due_date, task.status)
    if (tone !== 'overdue' && tone !== 'today' && tone !== 'soon') return false
  }

  if (filters.hideClosed && isClosed(task.status)) return false

  return true
}

/* -------------------------------------------------------------------------- */

export function BoardToolbar({
  filters, onChange, members, labels, right,
}: {
  filters: BoardFilterState
  onChange: (next: BoardFilterState) => void
  members: BoardMember[]
  labels: BoardLabel[]
  right?: React.ReactNode
}) {
  const [expanded, setExpanded] = React.useState(false)
  const active = filterCount(filters)

  function toggle<K extends keyof BoardFilterState>(key: K, value: string) {
    const list = filters[key] as unknown as string[]
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
    onChange({ ...filters, [key]: next })
  }

  return (
    <div className="card-surface space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={filters.query}
            onChange={(e) => onChange({ ...filters, query: e.target.value })}
            placeholder="Search this board"
            aria-label="Search tasks"
            type="search"
            className="pl-9"
          />
        </div>

        <FilterToggle
          active={filters.dueSoon}
          onClick={() => onChange({ ...filters, dueSoon: !filters.dueSoon })}
        >
          Due soon
        </FilterToggle>

        <FilterToggle
          active={filters.hideClosed}
          onClick={() => onChange({ ...filters, hideClosed: !filters.hideClosed })}
        >
          Hide done
        </FilterToggle>

        <Button
          variant="secondary"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <SlidersHorizontal />
          Filters
          {active ? (
            <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">
              {active}
            </span>
          ) : null}
        </Button>

        {active ? (
          <Button variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
            <X />
            Clear
          </Button>
        ) : null}

        {right ? <div className="ml-auto flex items-center gap-2">{right}</div> : null}
      </div>

      {expanded ? (
        <div className="grid gap-4 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <FacetGroup label="Assignee">
            <PersonChip
              selected={filters.assignees.includes('unassigned')}
              onClick={() => toggle('assignees', 'unassigned')}
              name="Unassigned"
            />
            {members.map((member) => (
              <PersonChip
                key={member.id}
                selected={filters.assignees.includes(member.id)}
                onClick={() => toggle('assignees', member.id)}
                name={member.full_name || member.email || 'Someone'}
                photoUrl={member.photo_url}
                email={member.email}
              />
            ))}
          </FacetGroup>

          <FacetGroup label="Priority">
            {PRIORITY_ORDER.map((priority) => (
              <Chip
                key={priority}
                selected={filters.priorities.includes(priority)}
                onClick={() => toggle('priorities', priority)}
              >
                {PRIORITY_LABEL[priority]}
              </Chip>
            ))}
          </FacetGroup>

          <FacetGroup label="Status">
            {STATUS_ORDER.map((status) => (
              <Chip
                key={status}
                selected={filters.statuses.includes(status)}
                onClick={() => toggle('statuses', status)}
              >
                {STATUS_LABEL[status]}
              </Chip>
            ))}
          </FacetGroup>

          <FacetGroup label="Labels">
            {labels.length === 0 ? (
              <p className="text-xs text-ink-muted">No labels on this board yet.</p>
            ) : (
              labels.map((label) => (
                <Chip
                  key={label.id}
                  selected={filters.labels.includes(label.id)}
                  onClick={() => toggle('labels', label.id)}
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: label.color }}
                    aria-hidden
                  />
                  {label.name}
                </Chip>
              ))
            )}
          </FacetGroup>
        </div>
      ) : null}
    </div>
  )
}

function FacetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  selected, onClick, children,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'focus-ring inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition',
        selected
          ? 'bg-brand-600 text-white ring-brand-600'
          : 'bg-card text-ink-muted ring-line hover:text-ink'
      )}
    >
      {children}
    </button>
  )
}

function PersonChip({
  selected, onClick, name, photoUrl, email,
}: {
  selected: boolean
  onClick: () => void
  name: string
  photoUrl?: string | null
  email?: string | null
}) {
  return (
    <Chip selected={selected} onClick={onClick}>
      <Avatar className="size-4">
        {photoUrl ? (
          <AvatarImage src={`/api/files/view?key=${encodeURIComponent(photoUrl)}`} alt="" />
        ) : null}
        <AvatarFallback className="text-[8px]">{initials(name, email)}</AvatarFallback>
      </Avatar>
      <span className="max-w-[9rem] truncate">{name}</span>
    </Chip>
  )
}

function FilterToggle({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button variant={active ? 'default' : 'secondary'} onClick={onClick} aria-pressed={active}>
      {children}
    </Button>
  )
}
