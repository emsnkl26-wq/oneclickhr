'use client'

/**
 * The board's client-side state: one place that owns the cards, applies a
 * change optimistically, rolls it back if the server refuses, and reconciles
 * with what the server sends next.
 *
 * WHY A HOOK AND NOT `router.refresh()` PER ACTION. A drag has to land where it
 * was dropped instantly — a card that snaps back for 300ms while a round trip
 * completes reads as a bug even when it works. So every mutation writes local
 * state first. That means there are briefly TWO sources of truth, and the rest
 * of this file is about the three ways they can disagree:
 *
 *   1. THE SERVER REFUSES. Roll back to exactly what was last confirmed, and
 *      say why. Leaving the optimistic value would show a move that never
 *      happened.
 *
 *   2. A REFRESH LANDS MID-FLIGHT. A Realtime event from somebody else arrives
 *      while our own PATCH is still in the air; the props that come back do not
 *      contain our change yet. Adopting them would make the card jump back and
 *      then forward again. So incoming props are ignored while any mutation is
 *      pending, and re-read once the last one settles.
 *
 *   3. OUR OWN WRITE ECHOES BACK. Every write we make also arrives as a
 *      Realtime event. Refreshing on it is wasted work at best and a flicker at
 *      worst, so events are debounced and a refresh already covered by a
 *      settling mutation is dropped.
 *
 * The subscription runs on the user's OWN auth session, so Supabase applies the
 * `tasks_select` policy to each subscriber — a tenant physically cannot receive
 * another tenant's change events, no custom token required. The tenant filter
 * below is a bandwidth optimisation, not the isolation boundary.
 */
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { createClient } from '@/lib/supabase/client'
import type { BoardData, BoardTask, BoardColumnData } from '@/lib/board-data'
import { positionBetween } from './board-vocabulary'

/** Long enough to absorb a burst of events from one drag, short enough to feel live. */
const REFRESH_DEBOUNCE_MS = 400

export interface BoardController {
  columns: BoardColumnData[]
  tasks: BoardTask[]
  tasksByColumn: Map<string, BoardTask[]>
  /** Drop a card into a column, before `beforeTaskId` (or at the end). */
  moveTask: (taskId: string, columnId: string, beforeTaskId: string | null) => Promise<void>
  moveColumn: (columnId: string, targetIndex: number) => Promise<void>
  patchTask: (taskId: string, patch: Record<string, unknown>, optimistic?: Partial<BoardTask>) => Promise<boolean>
  /** Resolves true once the server has confirmed; the card leaves only then. */
  deleteTask: (taskId: string) => Promise<boolean>
  archiveTask: (taskId: string, archived: boolean) => Promise<boolean>
  /** Cards with a write in flight, so the UI can show that a click registered. */
  savingTaskIds: ReadonlySet<string>
  refresh: () => void
}

export function useBoard(args: {
  board: BoardData
  tenantId: string
}): BoardController {
  const router = useRouter()
  const [columns, setColumns] = React.useState(args.board.columns)
  const [tasks, setTasks] = React.useState(args.board.tasks)

  // Not state: changing it must never re-render, and every read of it happens
  // inside an effect or a handler that runs after the write.
  const pending = React.useRef(0)
  const missedRefresh = React.useRef(false)

  // A count per card rather than a set: two quick edits to the same card must
  // not clear the spinner when the first one lands.
  const [savingCounts, setSavingCounts] = React.useState<Record<string, number>>({})
  const markSaving = React.useCallback((taskId: string, delta: 1 | -1) => {
    setSavingCounts((prev) => {
      const next = { ...prev }
      const count = (next[taskId] ?? 0) + delta
      if (count > 0) next[taskId] = count
      else delete next[taskId]
      return next
    })
  }, [])
  const savingTaskIds = React.useMemo(() => new Set(Object.keys(savingCounts)), [savingCounts])

  // Adopt fresh server data — unless we are mid-write, in which case the props
  // predate our own change and adopting them would rubber-band the card.
  React.useEffect(() => {
    if (pending.current > 0) {
      missedRefresh.current = true
      return
    }
    setTasks(args.board.tasks)
    setColumns(args.board.columns)
  }, [args.board.tasks, args.board.columns])

  const refresh = React.useCallback(() => {
    if (pending.current > 0) {
      missedRefresh.current = true
      return
    }
    router.refresh()
  }, [router])

  const settle = React.useCallback(() => {
    pending.current = Math.max(0, pending.current - 1)
    if (pending.current === 0 && missedRefresh.current) {
      missedRefresh.current = false
      router.refresh()
    }
  }, [router])

  /* ------------------------------------------------------------- realtime */

  React.useEffect(() => {
    if (!args.board.boardId) return

    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | undefined

    const onChange = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS)
    }

    // A refresh rather than patching local state from the payload: the payload
    // carries no assignee, label or checklist join, and reconciling two partial
    // sources is harder to keep right than re-reading one complete one.
    const channel = supabase
      .channel(`board:${args.board.boardId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `tenant_id=eq.${args.tenantId}` },
        onChange)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'board_columns', filter: `tenant_id=eq.${args.tenantId}` },
        onChange)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_assignees', filter: `tenant_id=eq.${args.tenantId}` },
        onChange)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_label_links', filter: `tenant_id=eq.${args.tenantId}` },
        onChange)
      .subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [args.board.boardId, args.tenantId, refresh])

  /* -------------------------------------------------------------- indexes */

  const tasksByColumn = React.useMemo(() => {
    const map = new Map<string, BoardTask[]>()
    for (const column of columns) map.set(column.id, [])
    for (const task of tasks) {
      const list = map.get(task.column_id)
      // A card whose column is not on this board (mid-refresh, or archived
      // column) is simply not placed rather than crashing the render.
      if (list) list.push(task)
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [tasks, columns])

  /* ------------------------------------------------------------ mutations */

  const patchTask = React.useCallback(
    async (
      taskId: string,
      patch: Record<string, unknown>,
      optimistic?: Partial<BoardTask>
    ): Promise<boolean> => {
      const previous = tasks
      if (optimistic) {
        setTasks((current) =>
          current.map((t) => (t.id === taskId ? { ...t, ...optimistic } : t))
        )
      }

      pending.current += 1
      markSaving(taskId, 1)
      try {
        await apiPatch(`/api/tasks/${taskId}`, patch)
        return true
      } catch (err) {
        if (optimistic) setTasks(previous)
        toast.error(err instanceof ApiClientError ? err.message : 'That change could not be saved')
        return false
      } finally {
        markSaving(taskId, -1)
        settle()
      }
    },
    [tasks, settle, markSaving]
  )

  const moveTask = React.useCallback(
    async (taskId: string, columnId: string, beforeTaskId: string | null) => {
      const task = tasks.find((t) => t.id === taskId)
      if (!task) return

      const siblings = (tasksByColumn.get(columnId) ?? []).filter((t) => t.id !== taskId)

      let position: number
      if (beforeTaskId) {
        const index = siblings.findIndex((t) => t.id === beforeTaskId)
        position = index === -1
          ? positionBetween(siblings[siblings.length - 1]?.position, undefined)
          : positionBetween(siblings[index - 1]?.position, siblings[index]?.position)
      } else {
        position = positionBetween(siblings[siblings.length - 1]?.position, undefined)
      }

      if (task.column_id === columnId && task.position === position) return

      // A column that declares a status applies it on entry — mirrored here so
      // the card's chip changes with the drop rather than a refresh later. The
      // database trigger is what actually decides; this only predicts it.
      const target = columns.find((c) => c.id === columnId)
      const status =
        target?.applies_status && target.id !== task.column_id ? target.applies_status : task.status

      await patchTask(
        taskId,
        { columnId, position },
        { column_id: columnId, position, status }
      )
    },
    [tasks, tasksByColumn, columns, patchTask]
  )

  const moveColumn = React.useCallback(
    async (columnId: string, targetIndex: number) => {
      const ordered = [...columns].sort((a, b) => a.position - b.position)
      const from = ordered.findIndex((c) => c.id === columnId)
      if (from === -1 || from === targetIndex) return

      const without = ordered.filter((c) => c.id !== columnId)
      const position = positionBetween(
        without[targetIndex - 1]?.position,
        without[targetIndex]?.position
      )

      const previous = columns
      setColumns((current) =>
        current.map((c) => (c.id === columnId ? { ...c, position } : c))
      )

      pending.current += 1
      try {
        await apiPatch(`/api/board/columns/${columnId}`, { position })
      } catch (err) {
        setColumns(previous)
        toast.error(err instanceof ApiClientError ? err.message : 'That column could not be moved')
      } finally {
        settle()
      }
    },
    [columns, settle]
  )

  /*
   * Delete and archive are NOT optimistic. They are started from the open
   * dialog, and removing the card up front would close that dialog before the
   * person could see whether the click worked. So the button spins, and the
   * card leaves once the server has agreed.
   */
  const deleteTask = React.useCallback(
    async (taskId: string): Promise<boolean> => {
      pending.current += 1
      markSaving(taskId, 1)
      try {
        await apiDelete(`/api/tasks/${taskId}`)
        setTasks((current) => current.filter((t) => t.id !== taskId))
        toast.success('Task deleted')
        return true
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : 'That task could not be deleted')
        return false
      } finally {
        markSaving(taskId, -1)
        settle()
      }
    },
    [settle, markSaving]
  )

  const archiveTask = React.useCallback(
    async (taskId: string, archived: boolean): Promise<boolean> => {
      pending.current += 1
      markSaving(taskId, 1)
      try {
        await apiPatch(`/api/tasks/${taskId}`, { archived })
        // Archiving removes the card from the board's own view, so it leaves
        // the list rather than being marked in place.
        setTasks((current) => current.filter((t) => t.id !== taskId))
        toast.success(archived ? 'Task archived' : 'Task restored')
        return true
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : 'That task could not be archived')
        return false
      } finally {
        markSaving(taskId, -1)
        settle()
      }
    },
    [settle, markSaving]
  )

  const sortedColumns = React.useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns]
  )

  return {
    columns: sortedColumns,
    tasks,
    tasksByColumn,
    moveTask,
    moveColumn,
    patchTask,
    deleteTask,
    archiveTask,
    savingTaskIds,
    refresh,
  }
}
