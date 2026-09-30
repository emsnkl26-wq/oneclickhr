'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Download, FileText, MessageSquare, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import {
  WeekGrid, MAX_HOURS_PER_DAY, round2, rowTotal, type GridRow, type GridProject,
} from '@/components/timesheet/week-grid'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { addDays, formatLocal } from '@/lib/time'
import type { TimesheetStatus } from '@/types/db'

export interface ReviewTimesheet {
  id: string
  code: string
  weekStart: string
  status: TimesheetStatus
  weeklyLearnings: string | null
  /** Every file on the week, in upload order (044). */
  attachments: Array<{ key: string; name: string }>
  reviewNote: string | null
  reviewedAt: string | null
  employeeName: string
  /** Billable hours above the weekly threshold, computed by the database (049). */
  overtimeHours: number
  /** False for a salaried/day-rate or overtime-exempt placement. */
  overtimePayable: boolean
  /** The placement's overtime pay multiplier, when there is a placement. */
  overtimeMultiplier: number | null
  /** The workspace's weekly threshold; null when overtime is switched off. */
  overtimeThreshold: number | null
}

/**
 * The week plus the two decisions that can be made about it.
 *
 * While the week awaits review the reviewer may also CORRECT it — a mistyped
 * day, a line on the wrong project — rather than bouncing the whole week back
 * for a one-cell fix. A correction needs a reason, which the employee is
 * notified with; approval then prices the corrected hours.
 *
 * Approve is one click; reject asks for a reason and will not proceed without
 * one. That asymmetry is deliberate and is enforced server-side too
 * (`reviewTimesheetSchema` refuses a rejection with no note): a returned
 * timesheet with no explanation sends the employee back to a grid with nothing
 * to change, and they will simply resubmit it unchanged.
 */
export function TimesheetReview({
  timesheet, entries, projects, editableProjectIds, timezone,
}: {
  timesheet: ReviewTimesheet
  entries: GridRow[]
  projects: GridProject[]
  /** Projects a correction may put hours on: the employee's, plus any already on the week. */
  editableProjectIds: string[]
  timezone: string
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState<GridRow[]>(entries)
  const [reason, setReason] = React.useState('')
  const [editError, setEditError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const editableProjects = React.useMemo(() => {
    const allowed = new Set(editableProjectIds)
    return projects.filter((project) => allowed.has(project.id))
  }, [projects, editableProjectIds])
  const [decision, setDecision] = React.useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  // Overtime to approve, as typed — all of it unless the reviewer says less.
  const [approvedOvertime, setApprovedOvertime] = React.useState(String(timesheet.overtimeHours))
  // A correction can change the week's overtime; the default follows it.
  React.useEffect(() => {
    setApprovedOvertime(String(timesheet.overtimeHours))
  }, [timesheet.overtimeHours])

  const reviewsOvertime = timesheet.overtimeHours > 0 && timesheet.overtimePayable
  const approvedOvertimeValue = Number(approvedOvertime)
  const overtimeInvalid =
    reviewsOvertime &&
    (approvedOvertime.trim() === '' ||
      !Number.isFinite(approvedOvertimeValue) ||
      approvedOvertimeValue < 0 ||
      approvedOvertimeValue > timesheet.overtimeHours)

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(timesheet.weekStart, index)),
    [timesheet.weekStart]
  )

  const pending = timesheet.status === 'submitted'

  function startEditing() {
    setDraft(entries)
    setReason('')
    setEditError(null)
    setEditing(true)
  }

  /** The server re-checks all of this; here it only saves a round trip. */
  function validateDraft(): string | null {
    const lines = draft.filter((row) => row.projectId || row.taskName.trim() || rowTotal(row) > 0)
    if (!lines.length) return 'A timesheet needs at least one line.'
    if (lines.some((row) => !row.projectId && !row.taskName.trim())) {
      return 'Every line needs a project or a task description.'
    }
    for (let day = 0; day < 7; day++) {
      const total = round2(lines.reduce((sum, row) => sum + (row.hours[day] || 0), 0))
      if (total > MAX_HOURS_PER_DAY) return `A day cannot exceed ${MAX_HOURS_PER_DAY} hours.`
    }
    if (reason.trim().length < 3) return 'Say briefly why the hours changed — the employee is told.'
    return null
  }

  async function saveEdits() {
    const problem = validateDraft()
    if (problem) {
      setEditError(problem)
      return
    }
    setEditError(null)
    setSaving(true)
    try {
      await apiPatch(`/api/timesheets/${timesheet.id}/entries`, {
        reason: reason.trim(),
        entries: draft.map((row) => ({
          projectId: row.projectId || null,
          taskName: row.taskName.trim() || undefined,
          billable: row.billable,
          hoursSun: row.hours[0],
          hoursMon: row.hours[1],
          hoursTue: row.hours[2],
          hoursWed: row.hours[3],
          hoursThu: row.hours[4],
          hoursFri: row.hours[5],
          hoursSat: row.hours[6],
        })),
      })
      toast.success('Hours updated — the employee has been notified')
      setEditing(false)
      router.refresh()
    } catch (err) {
      setEditError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  async function submitDecision() {
    if (!decision) return
    setError(null)
    setBusy(true)
    try {
      await apiPatch(`/api/timesheets/${timesheet.id}/review`, {
        status: decision,
        note: note.trim() || undefined,
        ...(decision === 'approved' && reviewsOvertime
          ? { approvedOvertimeHours: Math.round(approvedOvertimeValue * 100) / 100 }
          : {}),
      })
      toast.success(decision === 'approved' ? 'Timesheet approved' : 'Timesheet returned')
      setDecision(null)
      setNote('')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {editing ? (
        <div className="space-y-4 rounded-xl border border-line bg-card p-4 shadow-sm">
          <FormError message={editError} />
          <WeekGrid days={days} rows={draft} projects={editableProjects} onChange={setDraft} />
          <FormField
            label="Reason for the change"
            hint="Sent to the employee with the new total."
            required
          >
            <Input
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Tuesday was logged as 18 h — corrected to 8 h."
            />
          </FormField>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={saveEdits}>
              <Check />
              Save hours
            </Button>
          </div>
        </div>
      ) : (
        <WeekGrid days={days} rows={entries} projects={projects} readOnly />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Weekly learnings</CardTitle>
          </CardHeader>
          <CardContent>
            {timesheet.weeklyLearnings ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{timesheet.weeklyLearnings}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <MessageSquare className="size-4" aria-hidden />
                Nothing was written for this week.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              Uploaded timesheet {timesheet.attachments.length === 1 ? 'file' : 'files'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {timesheet.attachments.length ? (
              <ul className="space-y-2">
                {timesheet.attachments.map((file) => (
                  <li
                    key={file.key}
                    className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-3"
                  >
                    <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>
                      {file.name}
                    </span>
                    <Button asChild size="sm" variant="secondary">
                      <a
                        href={`/api/files/view?key=${encodeURIComponent(file.key)}&download=${encodeURIComponent(
                          file.name || 'timesheet'
                        )}`}
                      >
                        <Download />
                        Download
                      </a>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">No attachments uploaded.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {timesheet.reviewNote && !pending ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {timesheet.status === 'rejected' ? 'Why this was returned' : 'Review note'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{timesheet.reviewNote}</p>
            {timesheet.reviewedAt ? (
              <p className="mt-2 text-xs text-ink-muted">
                {formatLocal(timesheet.reviewedAt, timezone, 'd MMM yyyy, HH:mm')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
        <p className="text-sm text-ink-muted">
          {pending
            ? reviewsOvertime
              ? `Includes ${timesheet.overtimeHours} h of overtime for you to approve. Approving adds these hours to the projects they were logged against.`
              : 'Approving adds these hours to the projects they were logged against.'
            : `This timesheet has already been ${timesheet.status}.`}
        </p>

        {pending && !editing ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={startEditing}>
              <Pencil />
              Edit hours
            </Button>
            <Button variant="secondary" onClick={() => setDecision('rejected')}>
              <X />
              Reject
            </Button>
            <Button onClick={() => setDecision('approved')}>
              <Check />
              Approve
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog
        open={!!decision}
        onOpenChange={(open) => {
          if (!open) {
            setDecision(null)
            setError(null)
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {decision === 'approved' ? 'Approve this timesheet?' : 'Return this timesheet?'}
            </DialogTitle>
            <DialogDescription>
              {timesheet.code} · {timesheet.employeeName}
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            {decision === 'rejected' ? (
              <FormField
                label="What needs changing?"
                hint="This is what the employee sees when the timesheet comes back."
                required
              >
                <Textarea
                  rows={4}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Thursday looks like it was logged against the wrong project."
                  autoFocus
                />
              </FormField>
            ) : (
              <>
                {reviewsOvertime ? (
                  <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <p className="text-sm text-amber-900 dark:text-amber-200">
                      <span className="font-semibold">{timesheet.overtimeHours} h overtime</span>{' '}
                      this week
                      {timesheet.overtimeThreshold != null
                        ? ` — billable hours above ${timesheet.overtimeThreshold} h.`
                        : '.'}
                      {timesheet.overtimeMultiplier != null
                        ? ` Approved overtime is paid at ${timesheet.overtimeMultiplier}× the rate.`
                        : ''}
                    </p>
                    <FormField
                      label="Overtime hours to approve"
                      hint={`Between 0 and ${timesheet.overtimeHours}. Overtime you don't approve is not paid or billed.`}
                      error={overtimeInvalid ? `Enter 0 to ${timesheet.overtimeHours}` : undefined}
                    >
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={timesheet.overtimeHours}
                        step={0.25}
                        value={approvedOvertime}
                        onChange={(event) => setApprovedOvertime(event.target.value)}
                        aria-invalid={overtimeInvalid}
                      />
                    </FormField>
                  </div>
                ) : null}
                <FormField label="Note" hint="Optional — the employee sees it on their timesheet.">
                  <Textarea
                    rows={3}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Thanks — approved for invoicing."
                  />
                </FormField>
              </>
            )}
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setDecision(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={decision === 'rejected' ? 'danger' : 'default'}
              loading={busy}
              disabled={(decision === 'rejected' && !note.trim()) || (decision === 'approved' && overtimeInvalid)}
              onClick={submitDecision}
            >
              {decision === 'approved' ? 'Approve' : 'Return to employee'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
