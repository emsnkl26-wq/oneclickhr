'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, KanbanSquare } from 'lucide-react'
import { toast } from 'sonner'
import { KanbanBoard } from '@/components/board/kanban-board'
import { PageHeader, EmptyState } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea, DateField, Checkbox } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import type { BoardData } from '@/lib/board-data'

export function BoardWorkspace({
  board, tenantId, currentUserId, canManage,
}: {
  board: BoardData
  tenantId: string
  currentUserId: string
  canManage: boolean
}) {
  const router = useRouter()
  const [taskColumn, setTaskColumn] = React.useState<string | null>(null)
  const [columnOpen, setColumnOpen] = React.useState(false)

  return (
    <div className="space-y-6">
      <PageHeader
        title={board.boardName}
        description="Drag cards between columns. Everyone in the workspace sees changes as they happen."
        actions={
          canManage && board.boardId ? (
            <>
              <Button variant="secondary" onClick={() => setColumnOpen(true)}>
                <Plus />
                Column
              </Button>
              <Button
                onClick={() => setTaskColumn(board.columns[0]?.id ?? null)}
                disabled={!board.columns.length}
              >
                <Plus />
                Task
              </Button>
            </>
          ) : null
        }
      />

      {!board.boardId ? (
        <div className="card-surface">
          <EmptyState
            icon={KanbanSquare}
            title="No board yet"
            description="A default board is created with every new workspace. If you are seeing this, ask support to re-run provisioning."
          />
        </div>
      ) : (
        <KanbanBoard
          boardId={board.boardId}
          columns={board.columns}
          initialTasks={board.tasks}
          tenantId={tenantId}
          canManage={canManage}
          currentUserId={currentUserId}
          onAddTask={canManage ? (columnId) => setTaskColumn(columnId) : undefined}
        />
      )}

      {board.boardId ? (
        <>
          <TaskDialog
            boardId={board.boardId}
            columns={board.columns}
            members={board.members}
            columnId={taskColumn}
            onClose={() => setTaskColumn(null)}
            onCreated={() => {
              setTaskColumn(null)
              router.refresh()
            }}
          />
          <ColumnDialog
            boardId={board.boardId}
            open={columnOpen}
            onClose={() => setColumnOpen(false)}
            onCreated={() => {
              setColumnOpen(false)
              router.refresh()
            }}
          />
        </>
      ) : null}
    </div>
  )
}

function TaskDialog({
  boardId, columns, members, columnId, onClose, onCreated,
}: {
  boardId: string
  columns: BoardData['columns']
  members: BoardData['members']
  columnId: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [priority, setPriority] = React.useState('medium')
  const [dueDate, setDueDate] = React.useState('')
  const [assigneeIds, setAssigneeIds] = React.useState<string[]>([])
  const [selectedColumn, setSelectedColumn] = React.useState(columnId ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (columnId) {
      setSelectedColumn(columnId)
      setTitle('')
      setDescription('')
      setPriority('medium')
      setDueDate('')
      setAssigneeIds([])
      setError(null)
      setFields({})
    }
  }, [columnId])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/tasks', {
        boardId,
        columnId: selectedColumn,
        title,
        description: description || undefined,
        priority,
        dueDate: dueDate || null,
        assigneeIds,
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

  return (
    <Dialog open={!!columnId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New task</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Title" error={fields.title} required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </FormField>

            <FormField label="Description" error={fields.description}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Column">
                <Select
                  value={selectedColumn}
                  onChange={(e) => setSelectedColumn(e.target.value)}
                >
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Priority">
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </Select>
              </FormField>
              <FormField label="Due date">
                <DateField value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </FormField>
            </div>

            <FormField label="Assign to" hint="Assigned teammates can move this card themselves.">
              <div className="scrollbar-thin max-h-40 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {members.length === 0 ? (
                  <p className="p-2 text-xs text-ink-muted">No teammates yet.</p>
                ) : (
                  members.map((member) => (
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
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ColumnDialog({
  boardId, open, onClose, onCreated,
}: {
  boardId: string
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/board/columns', { boardId, name })
      toast.success('Column added')
      setName('')
      onCreated()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>New column</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-4">
            <FormError message={error} />
            <FormField label="Column name" required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="In review"
                required
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Add column
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
