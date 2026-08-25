'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Download, FileText, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { WeekGrid, type GridRow, type GridProject } from '@/components/timesheet/week-grid'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { addDays, formatLocal } from '@/lib/time'
import type { TimesheetStatus } from '@/types/db'

export interface ReviewTimesheet {
  id: string
  code: string
  weekStart: string
  status: TimesheetStatus
  comments: string | null
  attachmentKey: string | null
  attachmentName: string | null
  reviewNote: string | null
  reviewedAt: string | null
  employeeName: string
}

/**
 * The read-only week plus the two decisions that can be made about it.
 *
 * Approve is one click; reject asks for a reason and will not proceed without
 * one. That asymmetry is deliberate and is enforced server-side too
 * (`reviewTimesheetSchema` refuses a rejection with no note): a returned
 * timesheet with no explanation sends the employee back to a grid with nothing
 * to change, and they will simply resubmit it unchanged.
 */
export function TimesheetReview({
  timesheet, entries, projects, timezone,
}: {
  timesheet: ReviewTimesheet
  entries: GridRow[]
  projects: GridProject[]
  timezone: string
}) {
  const router = useRouter()
  const [decision, setDecision] = React.useState<'approved' | 'rejected' | null>(null)
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const days = React.useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(timesheet.weekStart, index)),
    [timesheet.weekStart]
  )

  const pending = timesheet.status === 'submitted'

  async function submitDecision() {
    if (!decision) return
    setError(null)
    setBusy(true)
    try {
      await apiPatch(`/api/timesheets/${timesheet.id}/review`, {
        status: decision,
        note: note.trim() || undefined,
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
      <WeekGrid days={days} rows={entries} projects={projects} readOnly />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Employee comments</CardTitle>
          </CardHeader>
          <CardContent>
            {timesheet.comments ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{timesheet.comments}</p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <MessageSquare className="size-4" aria-hidden />
                No comments were added for this week.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Uploaded timesheet file</CardTitle>
          </CardHeader>
          <CardContent>
            {timesheet.attachmentKey ? (
              <div className="flex items-center gap-3 rounded-lg border border-line px-3.5 py-3">
                <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {timesheet.attachmentName || 'Attachment'}
                </span>
                <Button asChild size="sm" variant="secondary">
                  <a
                    href={`/api/files/view?key=${encodeURIComponent(timesheet.attachmentKey)}&download=${encodeURIComponent(
                      timesheet.attachmentName || 'timesheet'
                    )}`}
                  >
                    <Download />
                    Download
                  </a>
                </Button>
              </div>
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
            ? 'Approving adds these hours to the projects they were logged against.'
            : `This timesheet has already been ${timesheet.status}.`}
        </p>

        {pending ? (
          <div className="ml-auto flex items-center gap-2">
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
              <FormField label="Note" hint="Optional — the employee sees it on their timesheet.">
                <Textarea
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Thanks — approved for invoicing."
                />
              </FormField>
            )}
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setDecision(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={decision === 'rejected' ? 'danger' : 'default'}
              loading={busy}
              disabled={decision === 'rejected' && !note.trim()}
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
