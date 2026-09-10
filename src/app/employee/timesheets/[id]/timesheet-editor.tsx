'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Send, Trash2, AlertCircle, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, StatusChip } from '@/components/ui/patterns'
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea, Select } from '@/components/ui/input'
import { FormError, FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import {
  WeekGrid, emptyRow, rowTotal, round2, MAX_HOURS_PER_DAY,
  type GridRow, type GridProject,
} from '@/components/timesheet/week-grid'
import { AttachmentDrop, type Attachment } from '@/components/timesheet/attachment-drop'
import { TimesheetLetterhead, type LetterheadOrg } from '@/components/timesheet/letterhead'
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
  weeklyLearnings: string
  /** Which placement this week is worked under. '' when none is set. */
  assignmentId: string
  /**
   * What the EMPLOYEE earns from this week, once it has been approved.
   *
   * Not the invoice total, and deliberately nowhere near it. The organization
   * bills the vendor at a different (higher) rate; this is the employee's share
   * and the only money figure their session can see. See 022.
   */
  payAmount: number | null
  payCurrency: string | null
  attachmentKey: string | null
  attachmentName: string | null
  reviewNote: string | null
}

/** One of the employee's own placements. Carries pay, never bill. */
export interface EditorPlacement {
  id: string
  vendorName: string | null
  clientName: string | null
  payRate: number | null
  payCurrency: string
  rateUnit: string
}

/** What a local draft holds. Versioned so a shape change cannot be misread. */
interface StoredDraft {
  v: 1
  rows: GridRow[]
  weeklyLearnings: string
  attachment: Attachment | null
  savedAt: number
}

const DRAFT_VERSION = 1
const draftKey = (id: string) => `oneclickhr:timesheet-draft:${id}`

/** The comparable shape of the form — what "unsaved" is measured against. */
function fingerprint(rows: GridRow[], weeklyLearnings: string, attachment: Attachment | null) {
  return JSON.stringify({
    rows: rows
      .filter((row) => rowTotal(row) > 0 || row.projectId || row.taskName.trim())
      .map((row) => [row.projectId, row.taskName.trim(), row.billable, row.hours]),
    weeklyLearnings: weeklyLearnings.trim(),
    attachment: attachment?.key ?? null,
  })
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
 *
 * TYPED HOURS ARE NEVER ONLY IN REACT STATE. Every edit is mirrored into
 * `localStorage` under this timesheet's id, and restored — with the person's
 * consent, not silently — when they come back to a week they left mid-entry.
 * A week takes real effort to fill in; losing it to a failed request, a closed
 * tab or a stray click on "All timesheets" is the one failure this screen must
 * not have. The draft is cleared the moment a save succeeds, so it can never
 * shadow data the server already holds.
 */
export function TimesheetEditor({
  timesheet, entries, projects, placements, org,
}: {
  timesheet: EditorTimesheet
  entries: GridRow[]
  projects: GridProject[]
  placements: EditorPlacement[]
  org: LetterheadOrg
}) {
  const router = useRouter()
  const progressRouter = useProgressRouter()

  const editable = timesheet.status === 'open' || timesheet.status === 'rejected'

  const initial = React.useMemo(
    () => ({
      rows: entries.length ? entries : editable ? [emptyRow('row-initial')] : [],
      weeklyLearnings: timesheet.weeklyLearnings,
      attachment: timesheet.attachmentKey
        ? { key: timesheet.attachmentKey, name: timesheet.attachmentName || 'Attachment' }
        : null,
    }),
    [entries, editable, timesheet.weeklyLearnings, timesheet.attachmentKey, timesheet.attachmentName]
  )

  const [rows, setRows] = React.useState<GridRow[]>(initial.rows)
  const [weeklyLearnings, setWeeklyLearnings] = React.useState(initial.weeklyLearnings)
  /**
   * Whether submitting has been ATTEMPTED. The weekly-learnings box only turns
   * red once somebody has actually tried to submit — marking a field invalid
   * before they have reached the end of the form is nagging, not helping.
   */
  const [triedSubmit, setTriedSubmit] = React.useState(false)
  const learningsMissing = triedSubmit && !weeklyLearnings.trim()
  const [assignmentId, setAssignmentId] = React.useState(timesheet.assignmentId)
  const placement = placements.find((p) => p.id === assignmentId) ?? null
  const [attachment, setAttachment] = React.useState<Attachment | null>(initial.attachment)
  const [error, setError] = React.useState<string | null>(null)
  const [rowErrors, setRowErrors] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState<'save' | 'submit' | 'delete' | null>(null)
  const [confirmSubmit, setConfirmSubmit] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [recoverable, setRecoverable] = React.useState<StoredDraft | null>(null)

  // The server's version of this week, as a string. Anything else on screen is
  // unsaved work.
  const savedPrint = React.useMemo(
    () => fingerprint(initial.rows, initial.weeklyLearnings, initial.attachment),
    [initial]
  )
  const currentPrint = fingerprint(rows, weeklyLearnings, attachment)
  const dirty = editable && currentPrint !== savedPrint

  const rowKey = React.useRef(0)
  const newRow = () => {
    rowKey.current += 1
    return emptyRow(`row-${rowKey.current}-${Math.random().toString(36).slice(2, 8)}`)
  }

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(timesheet.weekStart, index)),
    [timesheet.weekStart]
  )

  const filled = rows.filter((row) => rowTotal(row) > 0 || row.projectId || row.taskName.trim())
  const totalHours = round2(filled.reduce((sum, row) => sum + rowTotal(row), 0))

  /* ---------------------------------------------------------------------
   * Draft recovery
   * ------------------------------------------------------------------ */

  // Offer, never impose. A draft that matches what the server already has is
  // noise, and one that does not may be older than a save made from another
  // tab — so the choice is the person's.
  React.useEffect(() => {
    if (!editable) return
    try {
      const raw = window.localStorage.getItem(draftKey(timesheet.id))
      if (!raw) return
      const draft = JSON.parse(raw) as StoredDraft
      if (draft?.v !== DRAFT_VERSION || !Array.isArray(draft.rows)) {
        window.localStorage.removeItem(draftKey(timesheet.id))
        return
      }
      if (fingerprint(draft.rows, draft.weeklyLearnings, draft.attachment) === savedPrint) {
        window.localStorage.removeItem(draftKey(timesheet.id))
        return
      }
      setRecoverable(draft)
    } catch {
      // A quota-blocked or private-mode browser simply has no draft to offer.
    }
    // Runs once per timesheet: re-running on every keystroke would re-offer a
    // draft the person just dismissed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timesheet.id, editable])

  // Mirror every edit. Writing the SAVED state would let a stale draft outlive
  // the save that made it redundant, so a clean form clears the key instead.
  //
  // Held off entirely while a recovered draft is still on offer: the form is
  // clean at that moment, so this would delete the very draft the banner is
  // asking about, and a reload before the person answered would lose it.
  React.useEffect(() => {
    if (!editable || recoverable) return
    const key = draftKey(timesheet.id)
    try {
      if (!dirty) {
        window.localStorage.removeItem(key)
        return
      }
      const draft: StoredDraft = { v: DRAFT_VERSION, rows, weeklyLearnings, attachment, savedAt: Date.now() }
      window.localStorage.setItem(key, JSON.stringify(draft))
    } catch {
      // Out of quota or storage denied — the in-memory form still works.
    }
  }, [editable, recoverable, dirty, rows, weeklyLearnings, attachment, timesheet.id])

  // The browser's own guard, for the tab close and the reload that no in-app
  // handler ever sees.
  React.useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  function restoreDraft() {
    if (!recoverable) return
    setRows(recoverable.rows.length ? recoverable.rows : [newRow()])
    setWeeklyLearnings(recoverable.weeklyLearnings ?? '')
    setAttachment(recoverable.attachment ?? null)
    setRecoverable(null)
    toast.success('Unsaved hours restored — save them when you are ready')
  }

  function discardDraft() {
    try {
      window.localStorage.removeItem(draftKey(timesheet.id))
    } catch {
      /* nothing to clear */
    }
    setRecoverable(null)
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(draftKey(timesheet.id))
    } catch {
      /* nothing to clear */
    }
  }

  /* ---------------------------------------------------------------------
   * Validation
   * ------------------------------------------------------------------ */

  /**
   * The same rules `saveTimesheetSchema` enforces, checked before the request.
   *
   * Not a substitute for the server check — it is the copy that can point at the
   * offending line while the person is still looking at it. The server stays
   * authoritative, and its `fields` are mapped back onto the same rows below.
   */
  function validate(submitting: boolean): { ok: boolean; message: string | null } {
    const next: Record<string, string> = {}

    for (const row of filled) {
      if (!row.projectId && !row.taskName.trim()) {
        next[row.key] = projects.length
          ? 'Pick a project or describe the task for this line'
          : 'Describe what you worked on'
      }
    }

    let message: string | null = null

    for (let day = 0; day < 7; day += 1) {
      const total = round2(filled.reduce((sum, row) => sum + (row.hours[day] || 0), 0))
      if (total > MAX_HOURS_PER_DAY) {
        message = `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]} adds up to ${total} hours — a day cannot exceed ${MAX_HOURS_PER_DAY}.`
        break
      }
    }

    if (!message && Object.keys(next).length) {
      message =
        Object.keys(next).length === 1
          ? 'One line still needs a project or a task description.'
          : `${Object.keys(next).length} lines still need a project or a task description.`
    }

    if (!message && submitting && filled.length === 0) {
      message = 'Add at least one line before submitting.'
    }

    // Only at submit: the field is legitimately empty all week, and a form that
    // refuses to save on Monday teaches people to type "n/a" on Monday.
    if (!message && submitting && !weeklyLearnings.trim()) {
      message = 'Add your learnings for the week before submitting.'
    }

    setRowErrors(next)
    return { ok: !message, message }
  }

  /** Turn `entries.2.taskName` from the server back into a highlighted line. */
  function applyServerFields(fields: Record<string, string> | undefined) {
    if (!fields) return
    const next: Record<string, string> = {}
    for (const [path, message] of Object.entries(fields)) {
      const match = /^entries\.(\d+)\./.exec(path)
      const row = match ? filled[Number(match[1])] : undefined
      if (row) next[row.key] = message
    }
    if (Object.keys(next).length) setRowErrors(next)
  }

  function body(submit: boolean) {
    return {
      submit,
      weeklyLearnings: weeklyLearnings.trim() || undefined,
      assignmentId: assignmentId || null,
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

  /* ---------------------------------------------------------------------
   * Saving
   * ------------------------------------------------------------------ */

  async function save(submit: boolean) {
    if (submit) setTriedSubmit(true)
    const check = validate(submit)
    if (!check.ok) {
      setError(check.message)
      setConfirmSubmit(false)
      return
    }

    setError(null)
    setBusy(submit ? 'submit' : 'save')
    try {
      await apiPatch(`/api/timesheets/${timesheet.id}`, body(submit))
      // The server now holds what is on screen, so the local copy is finished —
      // including an older draft still sitting behind the recovery banner, which
      // would otherwise offer to overwrite the save that just succeeded.
      clearDraft()
      setRecoverable(null)
      setRowErrors({})
      setConfirmSubmit(false)
      toast.success(submit ? 'Timesheet submitted for approval' : 'Draft saved')
      router.refresh()
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'Something went wrong.'
      if (err instanceof ApiClientError) applyServerFields(err.fields)
      setError(message)
      // The dialog stays open so the reason is read where the click happened.
      if (submit) toast.error(message)
    } finally {
      setBusy(null)
    }
  }

  /** Open the confirmation only for a week that will actually be accepted. */
  function askToSubmit() {
    const check = validate(true)
    if (!check.ok) {
      setError(check.message)
      toast.error(check.message ?? 'This timesheet is not ready to submit')
      return
    }
    setError(null)
    setConfirmSubmit(true)
  }

  async function remove() {
    setBusy('delete')
    try {
      await apiDelete(`/api/timesheets/${timesheet.id}`)
      clearDraft()
      toast.success('Timesheet deleted')
      // Refresh before leaving so the list is not rebuilt from a cached tree
      // that still contains the week we just removed.
      router.refresh()
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

      <TimesheetLetterhead
        org={org}
        code={timesheet.code}
        period={formatPeriod(timesheet.weekStart, timesheet.weekEnd)}
      />

      {recoverable ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-800"
        >
          <RotateCcw className="size-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">
            You have hours on this week that were never saved. Restore them?
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={discardDraft}>
              Discard
            </Button>
            <Button size="sm" onClick={restoreDraft}>
              Restore
            </Button>
          </div>
        </div>
      ) : null}

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
        rowErrors={rowErrors}
        onChange={(next) => setRows(next.length ? next : [newRow()])}
      />

      {editable && !projects.length ? (
        <p className="text-sm text-ink-muted">
          You are not assigned to any project yet, so leave the project blank and describe what you
          worked on instead. Every line needs one or the other.
        </p>
      ) : null}

      <PlacementCard
        placements={placements}
        assignmentId={assignmentId}
        onChange={setAssignmentId}
        editable={editable}
        placement={placement}
        payAmount={timesheet.payAmount}
        payCurrency={timesheet.payCurrency}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              Weekly learnings
              {editable ? <span className="ml-1 text-danger">*</span> : null}
            </CardTitle>
            {editable ? (
              <CardDescription>
                Required before you can submit. What you learned, what changed, anything your
                approver should know about the week.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            {editable ? (
              <>
                <Textarea
                  rows={5}
                  value={weeklyLearnings}
                  onChange={(event) => setWeeklyLearnings(event.target.value)}
                  aria-invalid={learningsMissing || undefined}
                  placeholder="What you picked up this week — a new tool, a process you improved, something the client asked for. Plus anything your approver should know: overtime, a client holiday, a day worked off-site."
                />
                {learningsMissing ? (
                  <p className="mt-1.5 text-[13px] text-danger">
                    Add your learnings for the week before submitting.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                {weeklyLearnings || 'Nothing was written for this week.'}
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
          {dirty ? (
            <span className="ml-2 text-xs font-medium text-amber-700">· Unsaved changes</span>
          ) : null}
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
                onClick={askToSubmit}
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

      <Dialog
        open={confirmSubmit}
        onOpenChange={(open) => !open && busy === null && setConfirmSubmit(false)}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Submit this timesheet?</DialogTitle>
            <DialogDescription>
              {formatPeriod(timesheet.weekStart, timesheet.weekEnd)} · {totalHours} hours
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3 pb-4">
            {/* The reason a submit failed belongs where the click was, not on a
                banner the dialog is covering. */}
            <FormError message={error} />
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
            <Button loading={busy === 'submit'} disabled={busy !== null} onClick={() => save(true)}>
              Submit for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={(open) => !open && busy === null && setConfirmDelete(false)}
      >
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

/**
 * Who this week was worked for, and what the employee earns from it.
 *
 * TWO DELIBERATE ABSENCES. There is no bill rate here and no invoice total,
 * because this component renders in an EMPLOYEE session and neither number is
 * theirs to see. `placements` comes from `my_assignments`, which has no
 * `bill_rate` column, and `payAmount` is the employee's own share written onto
 * the timesheet at approval. See the header of migration 022.
 *
 * The selector only appears when there is a genuine choice to make. Someone on
 * a single placement gets a read-only line, because a dropdown with one option
 * is a question with one answer.
 */
function PlacementCard({
  placements, assignmentId, onChange, editable, placement, payAmount, payCurrency,
}: {
  placements: EditorPlacement[]
  assignmentId: string
  onChange: (id: string) => void
  editable: boolean
  placement: EditorPlacement | null
  payAmount: number | null
  payCurrency: string | null
}) {
  if (!placements.length && !placement) return null

  const money = (value: number, currency: string) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where you worked</CardTitle>
        <CardDescription>
          The vendor is invoiced for this week; the end client is where you sit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editable && placements.length > 1 ? (
          <FormField label="Placement" required>
            <Select value={assignmentId} onChange={(event) => onChange(event.target.value)}>
              <option value="">Select a placement</option>
              {placements.map((option) => (
                <option key={option.id} value={option.id}>
                  {[option.vendorName ?? 'Vendor', option.clientName]
                    .filter(Boolean)
                    .join(' → ')}
                </option>
              ))}
            </Select>
          </FormField>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">Vendor</dt>
            <dd className="mt-0.5 text-sm">{placement?.vendorName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              End client
            </dt>
            <dd className="mt-0.5 text-sm">{placement?.clientName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              {payAmount != null ? 'Your earnings' : 'Your rate'}
            </dt>
            <dd className="tabular mt-0.5 text-sm font-medium">
              {payAmount != null && payCurrency
                ? money(payAmount, payCurrency)
                : placement?.payRate != null
                  ? `${money(placement.payRate, placement.payCurrency)} / ${placement.rateUnit}`
                  : '—'}
            </dd>
          </div>
        </dl>

        {payAmount == null && placement?.payRate != null ? (
          <p className="text-xs text-ink-muted">
            Your earnings for the week are worked out when this timesheet is approved.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
