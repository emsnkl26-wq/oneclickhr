'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Send, Trash2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, StatusChip } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { WeekGrid, emptyRow, rowTotal, type GridRow, type GridProject } from '@/components/timesheet/week-grid'
import { AttachmentDrop, type Attachment } from '@/components/timesheet/attachment-drop'
import { apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { useProgressRouter } from '@/lib/use-progress-router'
import { addDays, formatPeriod } from '@/lib/time'
import type { TimesheetStatus } from '@/types/db'

export interface EditorTimesheet {
  id: string
  code: string
  weekStart: string
  weekEnd: string
  status: TimesheetStatus
  comments: string
  attachmentKey: string | null
  attachmentName: string | null
  reviewNote: string | null
}

/**
 * The week, and everything that can be done to it.
 *
 * EDITABILITY IS DERIVED, NOT TRACKED. `open` and `rejected` are editable and
 * everything else is not, which is exactly the rule the API and
 * `tg_timesheets_guard` enforce. Deriving it here from the same status means the
 * screen can never offer a Save button for a request the server will refuse.
 *
 * The grid always carries one blank line at the bottom while editing, so adding
 * work never starts with a click on "Add a line". Blank lines are dropped
 * server-side, so that convenience costs nothing in the data.
 */
export function TimesheetEditor({
  timesheet, entries, projects,
}: {
  timesheet: EditorTimesheet
  entries: GridRow[]
  projects: GridProject[]
}) {
  const router = useRouter()
  const progressRouter = useProgressRouter()

  const editable = timesheet.status === 'open' || timesheet.status === 'rejected'

  const [rows, setRows] = React.useState<GridRow[]>(() =>
    entries.length ? entries : editable ? [emptyRow('row-initial')] : []
  )
  const [comments, setComments] = React.useState(timesheet.comments)
  const [attachment, setAttachment] = React.useState<Attachment | null>(
    timesheet.attachmentKey
      ? { key: timesheet.attachmentKey, name: timesheet.attachmentName || 'Attachment' }
      : null
  )
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'save' | 'submit' | 'delete' | null>(null)
  const [confirmSubmit, setConfirmSubmit] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(timesheet.weekStart, index)),
    [timesheet.weekStart]
  )

  const filled = rows.filter((row) => rowTotal(row) > 0 || row.projectId || row.taskName.trim())
  const totalHours = filled.reduce((sum, row) => sum + rowTotal(row), 0)

  function body(submit: boolean) {
    return {
      submit,
      comments: comments.trim() || undefined,
      attachmentKey: attachment?.key,
      attachmentName: attachment?.name,
      entries: filled.map((row) => ({
        projectId: row.projectId || null,
        taskName: row.taskName.trim() || undefined,
        billable: row.billable,
        hoursSun: row.hours[0], hoursMon: row.hours[1], hoursTue: row.hours[2],
        hoursWed: row.hours[3], hoursThu: row.hours[4], hoursFri: row.hours[5],
        hoursSat: row.hours[6],
      })),
    }
  }

  async function save(submit: boolean) {
    setError(null)
    setBusy(submit ? 'submit' : 'save')
    try {
      await apiPatch(`/api/timesheets/${timesheet.id}`, body(submit))
      toast.success(submit ? 'Timesheet submitted for approval' : 'Draft saved')
      setConfirmSubmit(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    setBusy('delete')
    try {
      await apiDelete(`/api/timesheets/${timesheet.id}`)
      toast.success('Timesheet deleted')
      progressRouter.push('/employee/timesheets')
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Timesheet ${timesheet.code}`}
        description={formatPeriod(timesheet.weekStart, timesheet.weekEnd)}
        actions={
          <>
            <StatusChip status={timesheet.status} className="self-center" />
            <Button asChild variant="secondary">
              <Link href="/employee/timesheets">
                <ArrowLeft />
                All timesheets
              </Link>
            </Button>
          </>
        }
      />

      {timesheet.status === 'rejected' && timesheet.reviewNote ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3.5 text-sm text-brand-700"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">This timesheet was returned</p>
            <p className="mt-0.5 leading-relaxed">{timesheet.reviewNote}</p>
          </div>
        </div>
      ) : null}

      {timesheet.status === 'submitted' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-700">
          Submitted and waiting for your organization to review it. You can still see everything
          here, but it cannot be edited until it is returned.
        </div>
      ) : null}

      <FormError message={error} />

      <WeekGrid
        days={days}
        rows={rows}
        projects={projects}
        readOnly={!editable}
        onChange={(next) => setRows(next.length ? next : [emptyRow(`row-${Date.now()}`)])}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Comments</CardTitle>
          </CardHeader>
          <CardContent>
            {editable ? (
              <Textarea
                rows={5}
                value={comments}
                onChange={(event) => setComments(event.target.value)}
                placeholder="Anything your approver should know about this week — overtime, a client holiday, a day worked off-site."
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                {comments || 'No comments were added.'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <AttachmentDrop value={attachment} onChange={setAttachment} disabled={!editable} />
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
        <p className="text-sm text-ink-muted">
          Total for the week{' '}
          <strong className="tabular ml-1 text-[17px] text-ink">{totalHours}</strong> hours
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editable ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(true)}
                disabled={busy !== null}
              >
                <Trash2 />
                Delete
              </Button>
              <Button
                variant="secondary"
                loading={busy === 'save'}
                disabled={busy !== null}
                onClick={() => save(false)}
              >
                <Save />
                Save
              </Button>
              <Button
                loading={busy === 'submit'}
                disabled={busy !== null || totalHours === 0}
                onClick={() => setConfirmSubmit(true)}
              >
                <Send />
                Submit
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              {timesheet.status === 'approved'
                ? 'Approved — these hours count towards your projects.'
                : 'This timesheet is locked.'}
            </p>
          )}
        </div>
      </div>

      <Dialog open={confirmSubmit} onOpenChange={(open) => !open && setConfirmSubmit(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Submit this timesheet?</DialogTitle>
            <DialogDescription>
              {formatPeriod(timesheet.weekStart, timesheet.weekEnd)} · {totalHours} hours
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              Once submitted you will not be able to edit it. If something needs changing, your
              organization can return it to you.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmSubmit(false)}
              disabled={busy !== null}
            >
              Keep editing
            </Button>
            <Button loading={busy === 'submit'} onClick={() => save(true)}>
              Submit for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete this timesheet?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              {timesheet.code} and every line on it will be removed. You can open the week again
              afterwards.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(false)}
              disabled={busy !== null}
            >
              Keep it
            </Button>
            <Button variant="danger" loading={busy === 'delete'} onClick={remove}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
