'use client'

/**
 * The three forms that create or configure things on a board: a new task, a
 * column's settings, and the label vocabulary.
 *
 * Kept together because they share one property worth stating once — none of
 * them decide anything. Each posts to a route, and each renders whatever the
 * server says back, including a refusal. The `canManage` flags upstream decide
 * which of them are OFFERED; the policies decide whether they work.
 */
import * as React from 'react'
import { Trash2, Plus, Palette, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea, DateField, Checkbox } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'
import type { BoardData, BoardColumnData } from '@/lib/board-data'
import type { TaskStatus } from '@/types/db'
import {
  STATUS_ORDER, STATUS_LABEL, PRIORITY_ORDER, PRIORITY_LABEL, DEFAULT_COLUMN_COLOR,
} from './board-vocabulary'

/** A small fixed palette. A full colour picker for a column swatch is a toy. */
const SWATCHES = [
  '#64748B', '#2563EB', '#16A34A', '#9333EA', '#DC2626',
  '#EA580C', '#0891B2', '#CA8A04', '#DB2777', '#4F46E5',
]

/* ------------------------------------------------------------- new task */

export function TaskCreateDialog({
  board, columnId, onClose, onCreated,
}: {
  board: BoardData
  /** Non-null opens the dialog, pre-filled with the column that was clicked. */
  columnId: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [priority, setPriority] = React.useState('medium')
  const [status, setStatus] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [estimate, setEstimate] = React.useState('')
  const [assigneeIds, setAssigneeIds] = React.useState<string[]>([])
  const [labelIds, setLabelIds] = React.useState<string[]>([])
  const [checklist, setChecklist] = React.useState<string[]>([])
  const [step, setStep] = React.useState('')
  const [selectedColumn, setSelectedColumn] = React.useState(columnId ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  // Reset on OPEN, not on close: a dialog that clears as it fades out shows the
  // user their work vanishing.
  React.useEffect(() => {
    if (!columnId) return
    setSelectedColumn(columnId)
    setTitle('')
    setDescription('')
    setPriority('medium')
    setStatus('')
    setDueDate('')
    setStartDate('')
    setEstimate('')
    setAssigneeIds([])
    setLabelIds([])
    setChecklist([])
    setStep('')
    setError(null)
    setFields({})
  }, [columnId])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/tasks', {
        boardId: board.boardId,
        columnId: selectedColumn,
        title,
        description: description || undefined,
        priority,
        // Left out entirely when the person did not choose one, so the column's
        // own `applies_status` decides — see the insert trigger.
        ...(status ? { status } : {}),
        dueDate: dueDate || null,
        startDate: startDate || null,
        estimateHours: estimate ? Number(estimate) : null,
        assigneeIds,
        labelIds,
        checklist,
      })
      toast.success('Task created')
      onCreated()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function addStep() {
    const text = step.trim()
    if (!text) return
    setChecklist((prev) => [...prev, text])
    setStep('')
  }

  return (
    <Dialog open={!!columnId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>

          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            <FormError message={error} />

            <FormField label="Title" error={fields.title} required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs doing?"
                required
                autoFocus
              />
            </FormField>

            <FormField label="Description" error={fields.description}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Stage">
                <Select
                  value={selectedColumn}
                  onChange={(e) => setSelectedColumn(e.target.value)}
                  aria-label="Stage"
                >
                  {board.columns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Priority">
                <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
                  {PRIORITY_ORDER.map((p) => (
                    <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                  ))}
                </Select>
              </FormField>

              <FormField label="Status" hint="Defaults to whatever the stage implies.">
                <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                  <option value="">From the stage</option>
                  {STATUS_ORDER.map((s) => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </Select>
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Start date" error={fields.startDate}>
                <DateField value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </FormField>
              <FormField label="Due date" error={fields.dueDate}>
                <DateField value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </FormField>
              <FormField label="Estimate (hours)" error={fields.estimateHours}>
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={estimate}
                  onChange={(e) => setEstimate(e.target.value)}
                />
              </FormField>
            </div>

            <FormField label="Assign to" hint="Assigned teammates can move and update this card.">
              <div className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {board.members.length === 0 ? (
                  <p className="p-2 text-xs text-ink-muted">No teammates yet.</p>
                ) : (
                  board.members.map((member) => (
                    <label
                      key={member.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-page"
                    >
                      <Checkbox
                        checked={assigneeIds.includes(member.id)}
                        onChange={(e) =>
                          setAssigneeIds((prev) =>
                            e.target.checked
                              ? [...prev, member.id]
                              : prev.filter((id) => id !== member.id)
                          )
                        }
                      />
                      <span className="truncate">{member.full_name || member.email}</span>
                    </label>
                  ))
                )}
              </div>
            </FormField>

            {board.labels.length ? (
              <FormField label="Labels">
                <div className="flex flex-wrap gap-1.5">
                  {board.labels.map((label) => {
                    const active = labelIds.includes(label.id)
                    return (
                      <button
                        key={label.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setLabelIds((prev) =>
                            active ? prev.filter((id) => id !== label.id) : [...prev, label.id]
                          )
                        }
                        className={cn(
                          'focus-ring rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition',
                          active ? 'text-white' : 'text-ink-muted ring-1 ring-inset ring-line hover:text-ink'
                        )}
                        style={active ? { backgroundColor: label.color } : undefined}
                      >
                        {label.name}
                      </button>
                    )
                  })}
                </div>
              </FormField>
            ) : null}

            <FormField label="Checklist" hint="Steps that do not need cards of their own.">
              <div className="space-y-1.5">
                {checklist.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex items-center gap-2 rounded-md bg-page px-2 py-1 text-sm">
                    <span className="min-w-0 flex-1 truncate">{item}</span>
                    <button
                      type="button"
                      onClick={() => setChecklist((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={`Remove ${item}`}
                      className="focus-ring rounded p-0.5 text-ink-muted hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={step}
                    onChange={(e) => setStep(e.target.value)}
                    onKeyDown={(event) => {
                      // Enter adds a step; it must not submit the whole form.
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      addStep()
                    }}
                    placeholder="Add a step…"
                    aria-label="Add a checklist step"
                  />
                  <Button type="button" variant="secondary" onClick={addStep} disabled={!step.trim()}>
                    <Plus />
                  </Button>
                </div>
              </div>
            </FormField>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>Create task</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------- column settings */

/**
 * Create or configure a stage.
 *
 * One dialog for both, because a new column and an existing one have exactly
 * the same fields; `column === null` is the create case.
 *
 * DELETING asks where the cards should go rather than refusing outright when
 * the column is occupied. The API still refuses a bare delete of a populated
 * column — `tasks.column_id` cascades, so that would destroy the work — but
 * "move them to Backlog, then remove this" is what somebody actually meant, and
 * making them do it card by card is how columns never get cleaned up.
 */
export function ColumnDialog({
  boardId, column, open, columns, onClose, onSaved,
}: {
  boardId: string
  column: BoardColumnData | null
  open: boolean
  columns: BoardColumnData[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState(DEFAULT_COLUMN_COLOR)
  const [wipLimit, setWipLimit] = React.useState('')
  const [appliesStatus, setAppliesStatus] = React.useState('')
  const [isBacklog, setIsBacklog] = React.useState(false)
  const [moveTo, setMoveTo] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setName(column?.name ?? '')
    setColor(column?.color ?? DEFAULT_COLUMN_COLOR)
    setWipLimit(column?.wip_limit != null ? String(column.wip_limit) : '')
    setAppliesStatus(column?.applies_status ?? '')
    setIsBacklog(column?.is_backlog ?? false)
    setMoveTo(columns.find((c) => c.id !== column?.id)?.id ?? '')
    setError(null)
  }, [open, column, columns])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const payload = {
      name,
      color,
      wipLimit: wipLimit ? Number(wipLimit) : null,
      appliesStatus: (appliesStatus || null) as TaskStatus | null,
      isBacklog,
    }

    try {
      if (column) await apiPatch(`/api/board/columns/${column.id}`, payload)
      else await apiPost('/api/board/columns', { boardId, ...payload })
      toast.success(column ? 'Column updated' : 'Column added')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!column) return
    if (!window.confirm(`Remove the "${column.name}" column?`)) return

    setDeleting(true)
    try {
      // `moveTo` is only meaningful when there is somewhere to move to. With one
      // column left, the API's "empty it first" refusal is the right answer.
      const query = moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''
      await apiDelete(`/api/board/columns/${column.id}${query}`)
      toast.success('Column removed')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'That column could not be removed')
    } finally {
      setDeleting(false)
    }
  }

  const others = columns.filter((c) => c.id !== column?.id)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{column ? 'Column settings' : 'New column'}</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="In review"
                required
                autoFocus
              />
            </FormField>

            <FormField label="Colour">
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setColor(swatch)}
                    aria-label={`Use ${swatch}`}
                    aria-pressed={color.toLowerCase() === swatch.toLowerCase()}
                    className={cn(
                      'focus-ring size-7 rounded-full ring-2 ring-offset-2 ring-offset-card transition',
                      color.toLowerCase() === swatch.toLowerCase() ? 'ring-ink' : 'ring-transparent'
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </FormField>

            <FormField
              label="Status applied on entry"
              hint="Dropping a card here sets this status. Leave blank if this stage has no equivalent."
            >
              <Select
                value={appliesStatus}
                onChange={(e) => setAppliesStatus(e.target.value)}
                aria-label="Status applied on entry"
              >
                <option value="">No change</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Work-in-progress limit"
              hint="A warning, not a block. Counts unfinished cards only."
            >
              <Input
                type="number"
                min={1}
                max={999}
                value={wipLimit}
                onChange={(e) => setWipLimit(e.target.value)}
                placeholder="No limit"
              />
            </FormField>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm">
              <Checkbox checked={isBacklog} onChange={(e) => setIsBacklog(e.target.checked)} />
              Treat this as the backlog
            </label>

            {column && others.length ? (
              <div className="space-y-2 rounded-lg border border-line bg-page/60 p-3">
                <p className="text-xs font-medium text-ink-muted">
                  Removing this column? Its cards move here.
                </p>
                <Select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move tasks to">
                  {others.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
            ) : null}
          </DialogBody>

          <DialogFooter className="sm:justify-between">
            {column ? (
              <Button
                type="button"
                variant="ghost"
                className="text-danger hover:text-danger"
                onClick={onDelete}
                loading={deleting}
              >
                <Trash2 />
                Remove column
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                {column ? 'Save' : 'Add column'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- labels */

/**
 * The board's label vocabulary.
 *
 * Org-only, which is the point: anyone able to invent a label turns the picker
 * into a junk drawer within a month. Applying an existing one stays open to
 * whoever is working the card.
 */
export function LabelManagerDialog({
  boardId, labels, open, onClose, onSaved,
}: {
  boardId: string
  labels: BoardData['labels']
  open: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = React.useState('')
  const [color, setColor] = React.useState(SWATCHES[1])
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function add(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/board/labels', { boardId, name, color })
      setName('')
      onSaved()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'That label could not be added')
    } finally {
      setSubmitting(false)
    }
  }

  const [removingId, setRemovingId] = React.useState<string | null>(null)

  async function remove(id: string, labelName: string) {
    if (!window.confirm(`Remove the "${labelName}" label from every card that has it?`)) return
    setRemovingId(id)
    try {
      await apiDelete(`/api/board/labels/${id}`)
      toast.success('Label removed')
      onSaved()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That label could not be removed')
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Labels</DialogTitle>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <FormError message={error} />

          {labels.length ? (
            <ul className="space-y-1">
              {labels.map((label) => (
                <li
                  key={label.id}
                  className="group/label flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-page"
                >
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: label.color }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
                  {removingId === label.id ? (
                    <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Removing" />
                  ) : (
                  <button
                    type="button"
                    onClick={() => remove(label.id, label.name)}
                    aria-label={`Remove ${label.name}`}
                    className="focus-ring rounded p-0.5 text-ink-muted/0 transition group-hover/label:text-ink-muted hover:!text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-ink-muted">
              No labels yet. They are how a board classifies work the columns cannot.
            </p>
          )}

          <form onSubmit={add} className="space-y-3 border-t border-line pt-4">
            <FormField label="New label" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Design"
                required
              />
            </FormField>

            <FormField label="Colour">
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => setColor(swatch)}
                    aria-label={`Use ${swatch}`}
                    aria-pressed={color === swatch}
                    className={cn(
                      'focus-ring size-7 rounded-full ring-2 ring-offset-2 ring-offset-card transition',
                      color === swatch ? 'ring-ink' : 'ring-transparent'
                    )}
                    style={{ backgroundColor: swatch }}
                  />
                ))}
              </div>
            </FormField>

            <Button type="submit" loading={submitting} disabled={!name.trim()}>
              <Palette />
              Add label
            </Button>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
