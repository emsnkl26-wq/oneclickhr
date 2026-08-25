'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { formatDayHeader, WEEK_DAY_LABELS } from '@/lib/time'
import { cn } from '@/lib/utils'

/** One task/project line of the week. `hours` is Sunday-first, seven entries. */
export interface GridRow {
  /** Local React key. Rows are replaced wholesale on save, so it is never sent. */
  key: string
  projectId: string
  taskName: string
  billable: boolean
  hours: number[]
}

export interface GridProject {
  id: string
  code: string
  name: string
  clientName?: string | null
}

export function emptyRow(key: string): GridRow {
  return { key, projectId: '', taskName: '', billable: true, hours: [0, 0, 0, 0, 0, 0, 0] }
}

export const rowTotal = (row: GridRow) => row.hours.reduce((sum, value) => sum + (value || 0), 0)

/**
 * The weekly hour grid.
 *
 * ONE COMPONENT, TWO MODES. The employee edits it and the org reads it, and the
 * two views have to agree on every number and every column — so `readOnly` picks
 * between an input and a rendered value inside the same table rather than
 * forking into a second component that would drift.
 *
 * Sunday-first, because that is what the period stored on the timesheet means
 * (`week_start` is always a Sunday) and a grid that disagreed with the period
 * label would file Sunday's hours under the wrong week in every export.
 *
 * The cell inputs are `type="text"` with a numeric input mode, deliberately: a
 * `number` input's scroll wheel silently changes the value under the pointer,
 * which on a grid of thirty-five cells is a data-integrity problem rather than
 * an annoyance.
 */
export function WeekGrid({
  days,
  rows,
  projects,
  readOnly,
  onChange,
  className,
}: {
  /** The seven `YYYY-MM-DD` dates, Sunday first. */
  days: string[]
  rows: GridRow[]
  projects: GridProject[]
  readOnly?: boolean
  onChange?: (rows: GridRow[]) => void
  className?: string
}) {
  const nextKey = React.useRef(0)

  const update = (next: GridRow[]) => onChange?.(next)

  const setRow = (key: string, patch: Partial<GridRow>) =>
    update(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const setHours = (key: string, dayIndex: number, raw: string) => {
    // Accept an empty box while someone is retyping a figure; it means zero.
    const parsed = raw.trim() === '' ? 0 : Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 24) return
    update(
      rows.map((row) =>
        row.key === key
          ? { ...row, hours: row.hours.map((value, i) => (i === dayIndex ? parsed : value)) }
          : row
      )
    )
  }

  const dayTotals = days.map((_, index) =>
    rows.reduce((sum, row) => sum + (row.hours[index] || 0), 0)
  )
  const grandTotal = dayTotals.reduce((sum, value) => sum + value, 0)
  const billableTotal = rows.filter((row) => row.billable).reduce((sum, row) => sum + rowTotal(row), 0)
  const nonBillableTotal = grandTotal - billableTotal

  return (
    <div className={cn('space-y-4', className)}>
      <div className="card-surface overflow-hidden">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-page/60">
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
                >
                  Project / task
                </th>
                {days.map((date, index) => (
                  <th key={date} scope="col" className="px-2 py-2 text-center">
                    <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink">
                      {WEEK_DAY_LABELS[index]}
                    </span>
                    <span className="tabular block text-[11px] font-normal text-ink-muted">
                      {formatDayHeader(date).split(', ')[1]}
                    </span>
                  </th>
                ))}
                <th
                  scope="col"
                  className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
                >
                  Total
                </th>
                {readOnly ? null : <th scope="col" className="w-12" />}
              </tr>
            </thead>

            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={days.length + (readOnly ? 2 : 3)}
                    className="px-4 py-10 text-center text-sm text-ink-muted"
                  >
                    No hours recorded for this week.
                  </td>
                </tr>
              ) : null}

              {rows.map((row) => (
                <tr key={row.key} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 align-top">
                    {readOnly ? (
                      <div className="min-w-[180px]">
                        <p className="font-medium">
                          {projectLabel(projects, row.projectId) || row.taskName || 'Task'}
                        </p>
                        {row.taskName && row.projectId ? (
                          <p className="text-xs text-ink-muted">{row.taskName}</p>
                        ) : null}
                        {!row.billable ? (
                          <p className="text-xs text-ink-muted">Non-billable</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="min-w-[220px] space-y-2">
                        <Select
                          value={row.projectId}
                          onChange={(e) => setRow(row.key, { projectId: e.target.value })}
                          aria-label="Project"
                        >
                          <option value="">No project</option>
                          {projects.map((project) => (
                            <option key={project.id} value={project.id}>
                              {project.code} · {project.name}
                            </option>
                          ))}
                        </Select>
                        <input
                          value={row.taskName}
                          onChange={(e) => setRow(row.key, { taskName: e.target.value })}
                          placeholder="Task description"
                          aria-label="Task description"
                          className="h-9 w-full rounded-lg border border-line bg-card px-3 text-sm shadow-sm outline-none transition-colors placeholder:text-ink-muted/70 hover:border-ink-muted/40 focus-visible:border-brand-600"
                        />
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                          <Checkbox
                            checked={row.billable}
                            onChange={(e) => setRow(row.key, { billable: e.target.checked })}
                          />
                          Billable
                        </label>
                      </div>
                    )}
                  </td>

                  {days.map((date, index) => (
                    <td key={date} className="px-2 py-2.5 text-center align-top">
                      {readOnly ? (
                        <span
                          className={cn(
                            'tabular text-sm',
                            row.hours[index] ? 'font-medium text-ink' : 'text-ink-muted'
                          )}
                        >
                          {row.hours[index] || 0}
                        </span>
                      ) : (
                        <div className="inline-flex flex-col items-center">
                          <input
                            value={String(row.hours[index] ?? 0)}
                            onChange={(e) => setHours(row.key, index, e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            inputMode="decimal"
                            aria-label={`Hours on ${formatDayHeader(date)}`}
                            className="tabular h-9 w-14 rounded-lg border border-line bg-card px-2 text-center text-sm shadow-sm outline-none transition-colors hover:border-ink-muted/40 focus-visible:border-brand-600"
                          />
                          <span className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
                            Hrs
                          </span>
                        </div>
                      )}
                    </td>
                  ))}

                  <td className="px-3 py-2.5 text-right align-top">
                    <span className="tabular text-sm font-semibold">{rowTotal(row)}</span>
                  </td>

                  {readOnly ? null : (
                    <td className="px-2 py-2.5 align-top">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Remove this line"
                        onClick={() => update(rows.filter((current) => current.key !== row.key))}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>

            <tfoot>
              <tr className="border-t border-line bg-page/60">
                <td className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Daily total
                </td>
                {dayTotals.map((total, index) => (
                  <td key={days[index]} className="px-2 py-3 text-center">
                    <span className="tabular text-sm font-semibold">{total}</span>
                  </td>
                ))}
                <td className="px-3 py-3 text-right">
                  <span className="tabular text-sm font-bold text-brand-600">{grandTotal}</span>
                </td>
                {readOnly ? null : <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {readOnly ? null : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              nextKey.current += 1
              update([...rows, emptyRow(`row-${Date.now()}-${nextKey.current}`)])
            }}
          >
            <Plus />
            Add a line
          </Button>
        )}

        <div className="ml-auto flex items-center gap-6 text-sm">
          <span className="text-ink-muted">
            Total billable{' '}
            <strong className="tabular ml-1 text-ink">{billableTotal}</strong>
          </span>
          <span className="text-ink-muted">
            Non-billable{' '}
            <strong className="tabular ml-1 text-ink">{nonBillableTotal}</strong>
          </span>
        </div>
      </div>
    </div>
  )
}

function projectLabel(projects: GridProject[], projectId: string): string {
  if (!projectId) return ''
  const project = projects.find((candidate) => candidate.id === projectId)
  return project ? `${project.code} · ${project.name}` : ''
}
