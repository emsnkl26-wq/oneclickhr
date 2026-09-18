'use client'

/**
 * The board list: every board the viewer can open, as a grid of cards.
 *
 * SHARED BY BOTH ROLES, like the workspace. The org sees every board in the
 * tenant and can create, edit and delete them and manage their rosters; an
 * employee sees only boards they are a member of. That second rule is NOT
 * decided here — `boards_select` (038) returns nothing else — so this component
 * only chooses which buttons to offer.
 */
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, KanbanSquare, MoreHorizontal, Pencil, Trash2, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Checkbox } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { PageHeader, EmptyState, LoadError } from '@/components/ui/patterns'
import { AvatarStack } from '@/components/ui/avatar-stack'
import { apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'
import type { BoardSummary, BoardMember } from '@/lib/board-data'
import { BOARD_COLORS, BOARD_COLOR_NAMES } from './board-colors'

export function BoardList({
  boards, people, canManage, basePath, loadFailed, title, description,
}: {
  boards: BoardSummary[]
  /** Everyone who can be put on a board (org only needs this). */
  people: BoardMember[]
  canManage: boolean
  /** `/org/board` or `/employee/tasks` — a board opens at `${basePath}/${id}`. */
  basePath: string
  loadFailed?: boolean
  title: string
  description: string
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<{ open: false } | { open: true; board: BoardSummary | null }>({ open: false })
  const [deleting, setDeleting] = React.useState<BoardSummary | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          canManage ? (
            <Button onClick={() => setEditing({ open: true, board: null })}>
              <Plus />
              New board
            </Button>
          ) : null
        }
      />

      {loadFailed ? (
        <LoadError what="your boards" />
      ) : boards.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={KanbanSquare}
            title={canManage ? 'No boards yet' : 'You are not on any board yet'}
            description={
              canManage
                ? 'Create a board for each team or project, then add the people who work on it.'
                : 'When someone adds you to a board, or assigns you a task, it will appear here.'
            }
            action={
              canManage ? (
                <Button onClick={() => setEditing({ open: true, board: null })}>
                  <Plus />
                  New board
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {boards.map((board) => (
            <BoardCard
              key={board.id}
              board={board}
              href={`${basePath}/${board.id}`}
              canManage={canManage}
              onEdit={() => setEditing({ open: true, board })}
              onDelete={() => setDeleting(board)}
            />
          ))}
        </div>
      )}

      {canManage ? (
        <>
          <BoardFormDialog
            open={editing.open}
            board={editing.open ? editing.board : null}
            people={people}
            onClose={() => setEditing({ open: false })}
            onSaved={(id) => {
              setEditing({ open: false })
              if (id) router.push(`${basePath}/${id}`)
              else router.refresh()
            }}
          />
          <DeleteBoardDialog
            board={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={() => {
              setDeleting(null)
              router.refresh()
            }}
          />
        </>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ card */

function BoardCard({
  board, href, canManage, onEdit, onDelete,
}: {
  board: BoardSummary
  href: string
  canManage: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const total = board.open_tasks + board.done_tasks
  const pct = total ? Math.round((board.done_tasks / total) * 100) : 0

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-card transition hover:shadow-md"
      style={{ borderTop: `4px solid ${board.color}` }}
    >
      {/* The whole card is the link; the menu sits above it. */}
      <Link href={href} className="focus-ring absolute inset-0 z-0 rounded-xl" aria-label={`Open ${board.name}`} />

      <div
        className="pointer-events-none relative flex flex-1 flex-col gap-3 p-4"
        style={{ backgroundImage: `linear-gradient(160deg, ${board.color}14, transparent 55%)` }}
      >
        <div className="flex items-start gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
            style={{ backgroundColor: board.color }}
            aria-hidden
          >
            <KanbanSquare className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-ink">{board.name}</p>
            <p className="line-clamp-2 text-[13px] text-ink-muted">
              {board.description || 'No description'}
            </p>
          </div>
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="focus-ring pointer-events-auto relative z-10 grid size-8 place-items-center rounded-md text-ink-muted hover:bg-page hover:text-ink"
                  aria-label={`Options for ${board.name}`}
                >
                  <MoreHorizontal className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="size-4" />
                  Edit board and members
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onDelete} className="text-danger">
                  <Trash2 className="size-4" />
                  Delete board
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="mt-auto space-y-2">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span>
              {board.open_tasks} open · {board.done_tasks} done
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-page">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: board.color }} />
          </div>
          <div className="flex items-center justify-between pt-1">
            {board.members.length ? (
              <AvatarStack people={board.members} size="sm" />
            ) : (
              <span className="text-xs text-ink-muted">No members yet</span>
            )}
            <span className="text-xs text-ink-muted">
              {board.members.length} {board.members.length === 1 ? 'member' : 'members'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------ create / edit form */

function BoardFormDialog({
  open, board, people, onClose, onSaved,
}: {
  open: boolean
  /** Null creates a new board. */
  board: BoardSummary | null
  people: BoardMember[]
  onClose: () => void
  /** Receives the new board's id on create, so the caller can open it. */
  onSaved: (createdId?: string) => void
}) {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [color, setColor] = React.useState<string>(BOARD_COLORS[0])
  const [memberIds, setMemberIds] = React.useState<string[]>([])
  const [query, setQuery] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  // Reset on OPEN, not on close — same reason as the task dialog.
  React.useEffect(() => {
    if (!open) return
    setName(board?.name ?? '')
    setDescription(board?.description ?? '')
    setColor(board?.color ?? BOARD_COLORS[0])
    setMemberIds(board?.members.map((m) => m.id) ?? [])
    setQuery('')
    setError(null)
    setFields({})
  }, [open, board])

  const visiblePeople = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return people
    return people.filter((p) =>
      `${p.full_name ?? ''} ${p.email ?? ''}`.toLowerCase().includes(q)
    )
  }, [people, query])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const body = { name, description: description || null, color, memberIds }
    try {
      if (board) {
        await apiPatch(`/api/board/boards/${board.id}`, body)
        toast.success('Board updated')
        onSaved()
      } else {
        const created = await apiPost<{ id: string; memberError?: string | null }>('/api/board/boards', body)
        toast.success('Board created')
        if (created.memberError) toast.error(created.memberError)
        onSaved(created.id)
      }
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{board ? 'Edit board' : 'New board'}</DialogTitle>
            <DialogDescription>
              {board
                ? 'Rename it, change its colour, or change who is on it.'
                : 'It starts with the same stages as your existing board.'}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            <FormError message={error} />

            <FormField label="Name" error={fields.name} required>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Website relaunch"
                maxLength={100}
                required
                autoFocus
              />
            </FormField>

            <FormField label="Description" error={fields.description}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="What is this board for?"
              />
            </FormField>

            <FormField label="Colour" error={fields.color}>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Board colour">
                {BOARD_COLORS.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    role="radio"
                    aria-checked={color === swatch}
                    aria-label={BOARD_COLOR_NAMES[swatch] ?? swatch}
                    title={BOARD_COLOR_NAMES[swatch] ?? swatch}
                    onClick={() => setColor(swatch)}
                    className={cn(
                      'focus-ring grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-card transition',
                      color === swatch ? 'ring-2 ring-ink' : 'hover:scale-110'
                    )}
                    style={{ backgroundColor: swatch }}
                  >
                    {color === swatch ? <Check className="size-4 text-white" aria-hidden /> : null}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField
              label="Members"
              hint="Employees see only the boards they are on. Assigning someone a task on this board also adds them."
            >
              <div className="space-y-2">
                {people.length > 6 ? (
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search people"
                    aria-label="Search people"
                  />
                ) : null}
                <div className="scrollbar-thin max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1.5">
                  {visiblePeople.length === 0 ? (
                    <p className="p-2 text-xs text-ink-muted">
                      {people.length ? 'Nobody matches.' : 'No employees yet.'}
                    </p>
                  ) : (
                    visiblePeople.map((person) => (
                      <label
                        key={person.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-page"
                      >
                        <Checkbox
                          checked={memberIds.includes(person.id)}
                          onChange={(e) =>
                            setMemberIds((prev) =>
                              e.target.checked
                                ? [...prev, person.id]
                                : prev.filter((id) => id !== person.id)
                            )
                          }
                        />
                        <span className="truncate">{person.full_name || person.email}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-ink-muted">
                  {memberIds.length} selected
                </p>
              </div>
            </FormField>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {board ? 'Save' : 'Create board'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------------- delete */

function DeleteBoardDialog({
  board, onClose, onDeleted,
}: {
  board: BoardSummary | null
  onClose: () => void
  onDeleted: () => void
}) {
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (board) setConfirm('')
  }, [board])

  async function onDelete() {
    if (!board) return
    setBusy(true)
    try {
      await apiDelete(`/api/board/boards/${board.id}`)
      toast.success('Board deleted')
      onDeleted()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That board could not be deleted')
    } finally {
      setBusy(false)
    }
  }

  const total = board ? board.open_tasks + board.done_tasks : 0

  return (
    <Dialog open={!!board} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete {board?.name}?</DialogTitle>
          <DialogDescription>
            {total
              ? `Its ${total} ${total === 1 ? 'task' : 'tasks'}, with their comments and history, are deleted too. This cannot be undone.`
              : 'This cannot be undone.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <FormField label="Type the board's name to confirm">
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onDelete}
            disabled={busy || confirm.trim() !== board?.name.trim()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete board
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
