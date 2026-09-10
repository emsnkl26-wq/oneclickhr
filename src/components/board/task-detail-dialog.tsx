'use client'

/**
 * A card, opened.
 *
 * WHY THE DETAIL IS FETCHED RATHER THAN PASSED IN. The board already holds
 * every card, so it is tempting to hand this component the one it needs and be
 * done. But a card's THREAD, checklist and history are not on the board — they
 * are deliberately excluded from `loadBoard`, because shipping two hundred
 * comment threads to draw two hundred badges is how a board stops opening. So
 * the summary comes from the board's own state (already there, always current)
 * and the rest is fetched on open, for exactly the card being looked at.
 *
 * WHAT SAVES IMMEDIATELY AND WHAT DOES NOT. Status, priority, column,
 * assignees, labels, due date and every checklist tick write on change — they
 * are single-value decisions, and a "Save" button between the decision and the
 * effect is a button people forget to press. The title and description are
 * free text and save on blur or on an explicit Save, because autosaving prose
 * mid-sentence produces a history full of half-typed titles.
 *
 * PERMISSIONS. `canEdit` mirrors `tasks_update`, `canModerate` mirrors the org
 * half of `task_comments_delete`. Both only decide what is OFFERED — every
 * write is decided again by a policy, and a refusal comes back as a toast.
 */
import * as React from 'react'
import {
  MessageSquare, CheckSquare, History, Trash2, Archive, ArchiveRestore, Bell, BellOff,
  Reply, Pencil, X, Check, Send, Plus, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody,
  Tabs, TabsList, TabsTrigger, TabsContent,
  Avatar, AvatarFallback, AvatarImage,
} from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, DateField, Checkbox } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import { apiGet, apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { createClient } from '@/lib/supabase/client'
import { cn, initials } from '@/lib/utils'
import type { BoardData, BoardTask, BoardMember, BoardLabel } from '@/lib/board-data'
import type { TaskDetail, TaskCommentNode, TaskChecklistRow, TaskActivityRow } from '@/lib/task-detail'
import type { TaskPriority, TaskStatus } from '@/types/db'
import {
  STATUS_ORDER, STATUS_LABEL, STATUS_CLASS, PRIORITY_ORDER, PRIORITY_LABEL,
  relativeTime, dueTone, DUE_CLASS, formatDueDate,
} from './board-vocabulary'

export function TaskDetailDialog({
  task, board, open, canEdit, canModerate, currentUserId, saving, onClose, onPatch, onDelete, onArchive,
}: {
  task: BoardTask | null
  board: BoardData
  open: boolean
  canEdit: boolean
  canModerate: boolean
  currentUserId: string
  /** A write for this card is in flight — drives the "Saving…" indicator. */
  saving: boolean
  onClose: () => void
  onPatch: (taskId: string, patch: Record<string, unknown>, optimistic?: Partial<BoardTask>) => Promise<boolean>
  onDelete: (taskId: string) => Promise<boolean>
  onArchive: (taskId: string, archived: boolean) => Promise<boolean>
}) {
  const [detail, setDetail] = React.useState<TaskDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [watchBusy, setWatchBusy] = React.useState(false)

  // "Saved" lingers briefly after a save lands, so a change that completed in
  // 80ms still reads as confirmed rather than as nothing having happened.
  const [justSaved, setJustSaved] = React.useState(false)
  const wasSaving = React.useRef(false)
  React.useEffect(() => {
    if (saving) {
      wasSaving.current = true
      setJustSaved(false)
      return
    }
    if (!wasSaving.current) return
    wasSaving.current = false
    setJustSaved(true)
    const timer = setTimeout(() => setJustSaved(false), 1500)
    return () => clearTimeout(timer)
  }, [saving])

  const taskId = task?.id ?? null

  const load = React.useCallback(async () => {
    if (!taskId) return
    try {
      const data = await apiGet<TaskDetail>(`/api/tasks/${taskId}`)
      setDetail(data)
    } catch (err) {
      // A card deleted from under the reader by somebody else: close rather
      // than leave a dialog describing something that no longer exists.
      if (err instanceof ApiClientError && err.status === 404) {
        onClose()
        return
      }
      toast.error('That task could not be loaded')
    }
  }, [taskId, onClose])

  React.useEffect(() => {
    if (!open || !taskId) {
      setDetail(null)
      return
    }
    setLoading(true)
    void load().finally(() => setLoading(false))
  }, [open, taskId, load])

  /*
   * Live thread. Scoped to this ONE task, so a busy board does not refetch a
   * discussion nobody has open. Same isolation guarantee as the board's own
   * subscription: it runs on the reader's session, so the SELECT policy decides
   * what reaches them.
   */
  React.useEffect(() => {
    if (!open || !taskId) return

    const supabase = createClient()
    const channel = supabase
      .channel(`task:${taskId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
        () => void load())
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_checklist_items', filter: `task_id=eq.${taskId}` },
        () => void load())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [open, taskId, load])

  if (!task) return null

  const watching = detail ? detail.watcherIds.includes(currentUserId) : false

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="xl" className="max-h-[92vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {task.reference ? (
              <span className="tabular text-sm font-normal text-ink-muted">#{task.reference}</span>
            ) : null}
            <span className="truncate">{task.title}</span>
            {saving ? (
              <span className="ml-2 inline-flex shrink-0 items-center gap-1 text-xs font-normal text-ink-muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Saving…
              </span>
            ) : justSaved ? (
              <span className="ml-2 inline-flex shrink-0 items-center gap-1 text-xs font-normal text-emerald-600">
                <Check className="size-3.5" aria-hidden />
                Saved
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <DialogBody className="grid max-h-[76vh] gap-6 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            <TitleAndDescription task={task} canEdit={canEdit} onPatch={onPatch} />

            <Tabs defaultValue="discussion">
              <TabsList>
                <TabsTrigger value="discussion">
                  <MessageSquare className="size-4" aria-hidden />
                  Discussion
                  {task.comment_count ? (
                    <span className="ml-1.5 text-xs text-ink-muted">{task.comment_count}</span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="checklist">
                  <CheckSquare className="size-4" aria-hidden />
                  Checklist
                  {task.checklist_total ? (
                    <span className="ml-1.5 text-xs text-ink-muted">
                      {task.checklist_done}/{task.checklist_total}
                    </span>
                  ) : null}
                </TabsTrigger>
                <TabsTrigger value="activity">
                  <History className="size-4" aria-hidden />
                  Activity
                </TabsTrigger>
              </TabsList>

              <TabsContent value="discussion">
                {loading && !detail ? (
                  <Loading />
                ) : (
                  <Discussion
                    taskId={task.id}
                    comments={detail?.comments ?? []}
                    currentUserId={currentUserId}
                    canModerate={canModerate}
                    onChanged={load}
                  />
                )}
              </TabsContent>

              <TabsContent value="checklist">
                {loading && !detail ? (
                  <Loading />
                ) : (
                  <ChecklistPanel
                    taskId={task.id}
                    items={detail?.checklist ?? []}
                    canEdit={canEdit}
                    onChanged={load}
                  />
                )}
              </TabsContent>

              <TabsContent value="activity">
                {loading && !detail ? (
                  <Loading />
                ) : (
                  <ActivityFeed activity={detail?.activity ?? []} columns={board.columns} />
                )}
              </TabsContent>
            </Tabs>
          </div>

          <TaskSidebar
            task={task}
            board={board}
            canEdit={canEdit}
            watching={watching}
            watchKnown={!!detail}
            watchBusy={watchBusy}
            onPatch={onPatch}
            onToggleWatch={async () => {
              if (watchBusy) return
              setWatchBusy(true)
              try {
                if (watching) await apiDelete(`/api/tasks/${task.id}/watch`)
                else await apiPost(`/api/tasks/${task.id}/watch`)
                await load()
                toast.success(
                  watching
                    ? 'You will no longer be notified about comments on this task'
                    : 'You will be notified when someone comments on this task'
                )
              } catch {
                toast.error('That could not be changed')
              } finally {
                setWatchBusy(false)
              }
            }}
            onArchive={async () => {
              if (await onArchive(task.id, !task.archived_at)) onClose()
            }}
            onDelete={async () => {
              if (await onDelete(task.id)) onClose()
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Loading…
    </div>
  )
}

/* --------------------------------------------------------- title and body */

/**
 * Free text, saved on blur.
 *
 * The local copy is re-seeded whenever the SERVER's value changes, so an edit
 * somebody else makes appears here — but only while this field is not the one
 * being typed in, which is what the `dirty` guard is for. Without it, a
 * Realtime refresh mid-sentence would overwrite what the person is writing.
 */
function TitleAndDescription({
  task, canEdit, onPatch,
}: {
  task: BoardTask
  canEdit: boolean
  onPatch: (id: string, patch: Record<string, unknown>, optimistic?: Partial<BoardTask>) => Promise<boolean>
}) {
  const [title, setTitle] = React.useState(task.title)
  const [description, setDescription] = React.useState(task.description ?? '')
  const dirty = React.useRef(false)

  React.useEffect(() => {
    if (dirty.current) return
    setTitle(task.title)
    setDescription(task.description ?? '')
  }, [task.title, task.description])

  async function commitTitle() {
    dirty.current = false
    const next = title.trim()
    if (!next || next === task.title) {
      setTitle(task.title)
      return
    }
    const ok = await onPatch(task.id, { title: next }, { title: next })
    if (!ok) setTitle(task.title)
  }

  async function commitDescription() {
    dirty.current = false
    const next = description.trim()
    if (next === (task.description ?? '')) return
    const value = next || null
    const ok = await onPatch(task.id, { description: value }, { description: value })
    if (!ok) setDescription(task.description ?? '')
  }

  if (!canEdit) {
    return (
      <div className="space-y-2">
        <h2 className="text-lg font-semibold leading-snug">{task.title}</h2>
        {task.description ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
            {task.description}
          </p>
        ) : (
          <p className="text-sm text-ink-muted">No description.</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Input
        value={title}
        onChange={(e) => {
          dirty.current = true
          setTitle(e.target.value)
        }}
        onBlur={commitTitle}
        aria-label="Task title"
        className="text-base font-semibold"
      />
      <Textarea
        value={description}
        onChange={(e) => {
          dirty.current = true
          setDescription(e.target.value)
        }}
        onBlur={commitDescription}
        rows={4}
        placeholder="Add more detail…"
        aria-label="Task description"
      />
    </div>
  )
}

/* ------------------------------------------------------------- discussion */

function Discussion({
  taskId, comments, currentUserId, canModerate, onChanged,
}: {
  taskId: string
  comments: TaskCommentNode[]
  currentUserId: string
  canModerate: boolean
  onChanged: () => Promise<void>
}) {
  const [body, setBody] = React.useState('')
  const [sending, setSending] = React.useState(false)

  async function post() {
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await apiPost(`/api/tasks/${taskId}/comments`, { body: text })
      setBody('')
      await onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That comment could not be posted')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(event) => {
            // Enter makes a paragraph; Ctrl/Cmd+Enter sends. The other way round
            // costs somebody a half-written comment the first time they use it.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void post()
            }
          }}
          rows={3}
          placeholder="Write a comment…"
          aria-label="Write a comment"
        />
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-ink-muted">Ctrl + Enter to send</p>
          <Button size="sm" onClick={post} loading={sending} disabled={!body.trim()}>
            <Send />
            Comment
          </Button>
        </div>
      </div>

      {comments.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">
          No discussion yet. Start one.
        </p>
      ) : (
        <ol className="space-y-4">
          {comments.map((comment) => (
            <li key={comment.id}>
              <CommentBlock
                taskId={taskId}
                comment={comment}
                currentUserId={currentUserId}
                canModerate={canModerate}
                onChanged={onChanged}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** A root comment, its replies, and the box to add another. */
function CommentBlock({
  taskId, comment, currentUserId, canModerate, onChanged,
}: {
  taskId: string
  comment: TaskCommentNode
  currentUserId: string
  canModerate: boolean
  onChanged: () => Promise<void>
}) {
  const [replying, setReplying] = React.useState(false)
  const [reply, setReply] = React.useState('')
  const [sending, setSending] = React.useState(false)

  async function postReply() {
    const text = reply.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await apiPost(`/api/tasks/${taskId}/comments`, { body: text, parentId: comment.id })
      setReply('')
      setReplying(false)
      await onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That reply could not be posted')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <CommentRow
        taskId={taskId}
        comment={comment}
        currentUserId={currentUserId}
        canModerate={canModerate}
        onChanged={onChanged}
        onReply={() => setReplying((v) => !v)}
      />

      {comment.replies.length ? (
        <ol className="mt-3 space-y-3 border-l-2 border-line pl-3">
          {comment.replies.map((child) => (
            <li key={child.id}>
              <CommentRow
                taskId={taskId}
                comment={child}
                currentUserId={currentUserId}
                canModerate={canModerate}
                onChanged={onChanged}
              />
            </li>
          ))}
        </ol>
      ) : null}

      {replying ? (
        <div className="mt-3 space-y-2 border-l-2 border-line pl-3">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void postReply()
              }
            }}
            rows={2}
            placeholder="Write a reply…"
            aria-label="Write a reply"
            autoFocus
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={postReply} loading={sending} disabled={!reply.trim()}>
              Reply
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * One comment.
 *
 * A soft-deleted comment renders as a TOMBSTONE rather than vanishing: it is
 * only kept at all when replies still hang off it, and removing it from the
 * page would leave those replies answering whatever happens to precede them.
 */
function CommentRow({
  taskId, comment, currentUserId, canModerate, onChanged, onReply,
}: {
  taskId: string
  comment: TaskCommentNode
  currentUserId: string
  canModerate: boolean
  onChanged: () => Promise<void>
  onReply?: () => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(comment.body)
  const [busy, setBusy] = React.useState(false)

  const mine = comment.author_id === currentUserId

  if (comment.deleted_at) {
    return <p className="text-xs italic text-ink-muted">This comment was removed.</p>
  }

  async function save() {
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    try {
      await apiPatch(`/api/tasks/${taskId}/comments/${comment.id}`, { body: text })
      setEditing(false)
      await onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That edit could not be saved')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await apiDelete(`/api/tasks/${taskId}/comments/${comment.id}`)
      await onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That comment could not be removed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="group/comment flex gap-2.5">
      <Avatar className="size-7 shrink-0">
        {comment.photo_url ? (
          <AvatarImage
            src={`/api/files/view?key=${encodeURIComponent(comment.photo_url)}`}
            alt=""
          />
        ) : null}
        <AvatarFallback className="text-[9px]">
          {initials(comment.author_name, null)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-medium">{comment.author_name ?? 'Someone'}</span>
          <span className="text-[11px] text-ink-muted">{relativeTime(comment.created_at)}</span>
          {comment.edited_at ? (
            <span className="text-[11px] text-ink-muted/70">edited</span>
          ) : null}
        </div>

        {editing ? (
          <div className="mt-1.5 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              aria-label="Edit comment"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={save} loading={busy} disabled={!draft.trim()}>
                <Check />
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(comment.body)
                  setEditing(false)
                }}
              >
                <X />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {comment.body}
          </p>
        )}

        {!editing ? (
          <div className="mt-1 flex gap-3 opacity-0 transition group-hover/comment:opacity-100 focus-within:opacity-100">
            {onReply ? (
              <CommentAction icon={Reply} label="Reply" onClick={onReply} />
            ) : null}
            {mine ? (
              <CommentAction icon={Pencil} label="Edit" onClick={() => setEditing(true)} />
            ) : null}
            {mine || canModerate ? (
              <CommentAction
                icon={busy ? Loader2 : Trash2}
                label={busy ? 'Deleting…' : 'Delete'}
                onClick={remove}
                disabled={busy}
                danger
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CommentAction({
  icon: Icon, label, onClick, disabled, danger,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'focus-ring inline-flex items-center gap-1 rounded text-[11px] font-medium text-ink-muted transition hover:text-ink disabled:opacity-50',
        danger && 'hover:text-danger'
      )}
    >
      <Icon className={cn('size-3', disabled && Icon === Loader2 && 'animate-spin')} />
      {label}
    </button>
  )
}

/* -------------------------------------------------------------- checklist */

function ChecklistPanel({
  taskId, items, canEdit, onChanged,
}: {
  taskId: string
  items: TaskChecklistRow[]
  canEdit: boolean
  onChanged: () => Promise<void>
}) {
  const [content, setContent] = React.useState('')
  const [adding, setAdding] = React.useState(false)
  // Ticks feel instant; the refetch that follows confirms them.
  const [optimistic, setOptimistic] = React.useState<Record<string, boolean>>({})
  // Items with a write in flight: they show a spinner and ignore further clicks.
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set())
  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const done = items.filter((i) => optimistic[i.id] ?? i.is_done).length
  const percent = items.length ? Math.round((done / items.length) * 100) : 0

  async function add() {
    const text = content.trim()
    if (!text || adding) return
    setAdding(true)
    try {
      await apiPost(`/api/tasks/${taskId}/checklist`, { content: text })
      setContent('')
      await onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That step could not be added')
    } finally {
      setAdding(false)
    }
  }

  async function toggle(item: TaskChecklistRow, next: boolean) {
    if (busyIds.has(item.id)) return
    setOptimistic((prev) => ({ ...prev, [item.id]: next }))
    setBusy(item.id, true)
    try {
      await apiPatch(`/api/tasks/${taskId}/checklist/${item.id}`, { isDone: next })
      await onChanged()
    } catch (err) {
      setOptimistic((prev) => {
        const copy = { ...prev }
        delete copy[item.id]
        return copy
      })
      toast.error(err instanceof ApiClientError ? err.message : 'That step could not be updated')
    } finally {
      setBusy(item.id, false)
    }
  }

  async function remove(id: string) {
    if (busyIds.has(id)) return
    setBusy(id, true)
    try {
      await apiDelete(`/api/tasks/${taskId}/checklist/${id}`)
      await onChanged()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That step could not be removed')
    } finally {
      setBusy(id, false)
    }
  }

  return (
    <div className="space-y-3 pt-4">
      {items.length ? (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-page">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="tabular text-xs font-medium text-ink-muted">
            {done}/{items.length}
          </span>
        </div>
      ) : null}

      <ul className="space-y-1">
        {items.map((item) => {
          const checked = optimistic[item.id] ?? item.is_done
          const itemBusy = busyIds.has(item.id)
          return (
            <li key={item.id} className="group/item flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-page">
              <Checkbox
                checked={checked}
                disabled={!canEdit || itemBusy}
                onChange={(e) => toggle(item, e.target.checked)}
                aria-label={item.content}
              />
              <span className={cn('min-w-0 flex-1 text-sm', checked && 'text-ink-muted line-through')}>
                {item.content}
              </span>
              {itemBusy ? (
                <Loader2 className="size-3.5 animate-spin text-ink-muted" aria-label="Saving" />
              ) : canEdit ? (
                <button
                  type="button"
                  onClick={() => remove(item.id)}
                  aria-label={`Remove ${item.content}`}
                  className="focus-ring rounded p-0.5 text-ink-muted/0 transition group-hover/item:text-ink-muted hover:!text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>

      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-muted">
          Break this task into steps.
        </p>
      ) : null}

      {canEdit ? (
        <div className="flex gap-2">
          <Input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void add()
            }}
            placeholder="Add a step…"
            aria-label="Add a checklist step"
          />
          <Button variant="secondary" onClick={add} loading={adding} disabled={!content.trim()}>
            <Plus />
            Add
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------- activity */

/**
 * The card's history, newest first.
 *
 * Column ids are resolved to NAMES here rather than stored as names in the log,
 * so a renamed column reads correctly in entries written before the rename. A
 * column since deleted has no name to show and falls back to "another column",
 * which is honest about what is left to know.
 */
function ActivityFeed({
  activity, columns,
}: {
  activity: TaskActivityRow[]
  columns: BoardData['columns']
}) {
  const nameById = React.useMemo(
    () => new Map(columns.map((c) => [c.id, c.name])),
    [columns]
  )

  if (!activity.length) {
    return <p className="py-6 text-center text-sm text-ink-muted">Nothing recorded yet.</p>
  }

  return (
    <ol className="space-y-2.5 pt-4">
      {activity.map((entry) => (
        <li key={entry.id} className="flex gap-2.5 text-sm">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-line" aria-hidden />
          <p className="min-w-0 flex-1 leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">{entry.actor_name ?? 'Someone'}</span>{' '}
            {describe(entry, nameById)}{' '}
            <span className="whitespace-nowrap text-[11px] text-ink-muted/70">
              {relativeTime(entry.created_at)}
            </span>
          </p>
        </li>
      ))}
    </ol>
  )
}

function describe(entry: TaskActivityRow, columnNames: Map<string, string>): string {
  const meta = entry.meta ?? {}
  const column = (id: unknown) =>
    typeof id === 'string' ? columnNames.get(id) ?? 'another column' : 'another column'
  const status = (value: unknown) =>
    typeof value === 'string' && value in STATUS_LABEL
      ? STATUS_LABEL[value as TaskStatus]
      : String(value ?? '')

  switch (entry.kind) {
    case 'created': return 'created this task'
    case 'moved': return `moved it to ${column(meta.to)}`
    case 'status_changed': return `changed the status to ${status(meta.to)}`
    case 'completed': return 'marked it done'
    case 'reopened': return `reopened it as ${status(meta.to)}`
    case 'priority_changed': return `set the priority to ${String(meta.to ?? '')}`
    case 'assigned': return `assigned ${String(meta.name ?? 'someone')}`
    case 'unassigned': return `unassigned ${String(meta.name ?? 'someone')}`
    case 'due_date_changed':
      return meta.to ? `set the due date to ${formatDueDate(String(meta.to))}` : 'cleared the due date'
    case 'renamed': return 'renamed this task'
    case 'commented': return meta.reply ? 'replied in the discussion' : 'commented'
    case 'archived': return 'archived it'
    case 'restored': return 'restored it'
    default: return 'updated this task'
  }
}

/* ---------------------------------------------------------------- sidebar */

function TaskSidebar({
  task, board, canEdit, watching, watchKnown, watchBusy, onPatch, onToggleWatch, onArchive, onDelete,
}: {
  task: BoardTask
  board: BoardData
  canEdit: boolean
  watching: boolean
  /** False until the detail has loaded — before that, "watching" is a guess. */
  watchKnown: boolean
  watchBusy: boolean
  onPatch: (id: string, patch: Record<string, unknown>, optimistic?: Partial<BoardTask>) => Promise<boolean>
  onToggleWatch: () => Promise<void>
  onArchive: () => Promise<void>
  onDelete: () => Promise<void>
}) {
  const tone = dueTone(task.due_date, task.status)
  const [busy, setBusy] = React.useState<'archive' | 'delete' | null>(null)

  async function run(kind: 'archive' | 'delete', action: () => Promise<void>) {
    setBusy(kind)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  return (
    <aside className="space-y-4 lg:border-l lg:border-line lg:pl-6">
      <FormField label="Status">
        {canEdit ? (
          <Select
            value={task.status}
            onChange={(e) =>
              onPatch(task.id, { status: e.target.value }, { status: e.target.value as TaskStatus })
            }
            aria-label="Status"
          >
            {STATUS_ORDER.map((status) => (
              <option key={status} value={status}>{STATUS_LABEL[status]}</option>
            ))}
          </Select>
        ) : (
          <span
            className={cn(
              'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
              STATUS_CLASS[task.status]
            )}
          >
            {STATUS_LABEL[task.status]}
          </span>
        )}
      </FormField>

      <FormField label="Stage">
        {canEdit ? (
          <Select
            value={task.column_id}
            onChange={(e) =>
              onPatch(task.id, { columnId: e.target.value }, { column_id: e.target.value })
            }
            aria-label="Stage"
          >
            {board.columns.map((column) => (
              <option key={column.id} value={column.id}>{column.name}</option>
            ))}
          </Select>
        ) : (
          <p className="text-sm">
            {board.columns.find((c) => c.id === task.column_id)?.name ?? '—'}
          </p>
        )}
      </FormField>

      <FormField label="Priority">
        {canEdit ? (
          <Select
            value={task.priority}
            onChange={(e) =>
              onPatch(task.id, { priority: e.target.value }, { priority: e.target.value as TaskPriority })
            }
            aria-label="Priority"
          >
            {PRIORITY_ORDER.map((priority) => (
              <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>
            ))}
          </Select>
        ) : (
          <p className="text-sm">{PRIORITY_LABEL[task.priority]}</p>
        )}
      </FormField>

      <FormField label="Due date">
        {canEdit ? (
          <DateField
            value={task.due_date ?? ''}
            onChange={(e) => {
              const value = e.target.value || null
              void onPatch(task.id, { dueDate: value }, { due_date: value })
            }}
            aria-label="Due date"
          />
        ) : (
          <p className={cn('text-sm', DUE_CLASS[tone])}>
            {task.due_date ? formatDueDate(task.due_date) : '—'}
          </p>
        )}
      </FormField>

      <PeoplePicker
        label="Assignees"
        members={board.members}
        selected={task.assignees.map((a) => a.id)}
        canEdit={canEdit}
        onChange={(ids) => {
          const chosen = board.members.filter((m) => ids.includes(m.id))
          void onPatch(task.id, { assigneeIds: ids }, { assignees: chosen })
        }}
      />

      <LabelPicker
        labels={board.labels}
        selected={task.labels.map((l) => l.id)}
        canEdit={canEdit}
        onChange={(ids) => {
          const chosen = board.labels.filter((l) => ids.includes(l.id))
          void onPatch(task.id, { labelIds: ids }, { labels: chosen })
        }}
      />

      {/*
        Notifications. Watching a task means: when someone comments on it, you
        get a notification. Assignees, the creator and anyone who comments are
        subscribed automatically — this is the switch to opt in or out by hand.
      */}
      <div className="space-y-2 border-t border-line pt-4">
        <div className="flex items-start gap-2">
          {watching ? (
            <Bell className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
          ) : (
            <BellOff className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {watching ? 'Notifications on' : 'Notifications off'}
            </p>
            <p className="text-xs leading-relaxed text-ink-muted">
              {watching
                ? 'You get a notification when someone comments on this task.'
                : 'Turn on to get a notification when someone comments on this task.'}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={onToggleWatch}
          loading={watchBusy}
          disabled={!watchKnown}
        >
          {watching ? <BellOff /> : <Bell />}
          {watching ? 'Turn off notifications' : 'Notify me about comments'}
        </Button>
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        {canEdit ? (
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={() => run('archive', onArchive)}
            loading={busy === 'archive'}
            disabled={busy !== null}
          >
            {task.archived_at ? <ArchiveRestore /> : <Archive />}
            {busy === 'archive'
              ? task.archived_at ? 'Restoring…' : 'Archiving…'
              : task.archived_at ? 'Restore' : 'Archive'}
          </Button>
        ) : null}

        {canEdit ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-danger hover:text-danger"
            loading={busy === 'delete'}
            disabled={busy !== null}
            onClick={() => {
              // Archiving is reversible and is offered first; this is the door
              // marked "gone", so it asks.
              if (!window.confirm('Delete this task and its whole discussion? This cannot be undone.')) return
              void run('delete', onDelete)
            }}
          >
            <Trash2 />
            {busy === 'delete' ? 'Deleting…' : 'Delete'}
          </Button>
        ) : null}
      </div>
    </aside>
  )
}

function PeoplePicker({
  label, members, selected, canEdit, onChange,
}: {
  label: string
  members: BoardMember[]
  selected: string[]
  canEdit: boolean
  onChange: (ids: string[]) => void
}) {
  if (!canEdit) {
    return (
      <FormField label={label}>
        {selected.length ? (
          <div className="flex flex-wrap gap-1.5">
            {members
              .filter((m) => selected.includes(m.id))
              .map((m) => (
                <span key={m.id} className="flex items-center gap-1.5 rounded-full bg-page px-2 py-0.5 text-xs">
                  <Avatar className="size-4">
                    {m.photo_url ? (
                      <AvatarImage src={`/api/files/view?key=${encodeURIComponent(m.photo_url)}`} alt="" />
                    ) : null}
                    <AvatarFallback className="text-[8px]">
                      {initials(m.full_name, m.email)}
                    </AvatarFallback>
                  </Avatar>
                  {m.full_name || m.email}
                </span>
              ))}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Nobody yet</p>
        )}
      </FormField>
    )
  }

  return (
    <FormField label={label}>
      <div className="scrollbar-thin max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1.5">
        {members.length === 0 ? (
          <p className="p-2 text-xs text-ink-muted">No teammates yet.</p>
        ) : (
          members.map((member) => {
            const checked = selected.includes(member.id)
            return (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-page"
              >
                <Checkbox
                  checked={checked}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, member.id]
                        : selected.filter((id) => id !== member.id)
                    )
                  }
                />
                <Avatar className="size-5">
                  {member.photo_url ? (
                    <AvatarImage
                      src={`/api/files/view?key=${encodeURIComponent(member.photo_url)}`}
                      alt=""
                    />
                  ) : null}
                  <AvatarFallback className="text-[8px]">
                    {initials(member.full_name, member.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate">{member.full_name || member.email}</span>
              </label>
            )
          })
        )}
      </div>
    </FormField>
  )
}

function LabelPicker({
  labels, selected, canEdit, onChange,
}: {
  labels: BoardLabel[]
  selected: string[]
  canEdit: boolean
  onChange: (ids: string[]) => void
}) {
  if (!labels.length) return null

  return (
    <FormField label="Labels">
      <div className="flex flex-wrap gap-1.5">
        {labels.map((label) => {
          const active = selected.includes(label.id)
          if (!canEdit && !active) return null
          return (
            <button
              key={label.id}
              type="button"
              disabled={!canEdit}
              aria-pressed={active}
              onClick={() =>
                onChange(
                  active ? selected.filter((id) => id !== label.id) : [...selected, label.id]
                )
              }
              className={cn(
                'focus-ring rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition',
                active ? 'text-white' : 'text-ink-muted ring-1 ring-inset ring-line hover:text-ink',
                !canEdit && 'cursor-default'
              )}
              style={active ? { backgroundColor: label.color } : undefined}
            >
              {label.name}
            </button>
          )
        })}
      </div>
    </FormField>
  )
}
