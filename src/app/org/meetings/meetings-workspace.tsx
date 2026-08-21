'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CalendarDays, ExternalLink, Lock, Pencil, Plus, Trash2, Video,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, DateTimeField } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
  Tabs, TabsList, TabsTrigger,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import type { Meeting } from '@/types/db'

/** `datetime-local` needs `YYYY-MM-DDTHH:mm` in LOCAL time, not an ISO instant. */
function toLocalInput(iso: string): string {
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function MeetingsWorkspace({
  meetings, connected, timezone,
}: {
  meetings: Meeting[]
  connected: boolean
  timezone: string
}) {
  const router = useRouter()
  const [tab, setTab] = React.useState<'upcoming' | 'past'>('upcoming')
  const [editing, setEditing] = React.useState<Meeting | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Meeting | null>(null)
  const [busy, setBusy] = React.useState(false)

  const now = Date.now()
  const filtered = meetings.filter((m) =>
    tab === 'upcoming' ? new Date(m.end_time).getTime() >= now : new Date(m.end_time).getTime() < now
  )

  async function onDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await apiDelete(`/api/meetings/${deleting.id}`)
      toast.success('Meeting deleted')
      setDeleting(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="past">Past</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          {connected ? (
            <StatusChip status="connected" label="Google Calendar connected" />
          ) : (
            <Button asChild variant="ghost" size="sm">
              <Link href="/org/settings/integrations">Connect Google Calendar</Link>
            </Button>
          )}
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New meeting
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title={tab === 'upcoming' ? 'Nothing scheduled' : 'No past meetings'}
            description={
              tab === 'upcoming'
                ? 'Create a meeting here and it appears in Google Calendar too.'
                : 'Meetings move here once they have finished.'
            }
            action={
              tab === 'upcoming' ? (
                <Button onClick={() => setCreating(true)}>Schedule a meeting</Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {filtered.map((meeting) => (
            <li key={meeting.id}>
              <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3.5">
                  <span className="tabular grid w-14 shrink-0 rounded-lg bg-page py-2 text-center">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                      {formatLocal(meeting.start_time, timezone, 'MMM')}
                    </span>
                    <span className="text-lg font-bold leading-tight">
                      {formatLocal(meeting.start_time, timezone, 'd')}
                    </span>
                  </span>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{meeting.title}</p>
                      {meeting.source === 'google' ? (
                        <StatusChip status="info" tone="info" label="From Google" />
                      ) : null}
                    </div>
                    <p className="tabular mt-0.5 text-[13px] text-ink-muted">
                      {formatLocal(meeting.start_time, timezone, 'EEE d MMM, HH:mm')} –{' '}
                      {formatLocal(meeting.end_time, timezone, 'HH:mm')}
                    </p>
                    {meeting.location ? (
                      <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                        {meeting.location}
                      </p>
                    ) : null}
                    {meeting.attendees?.length ? (
                      <p className="mt-1 truncate text-xs text-ink-muted">
                        {meeting.attendees.length}{' '}
                        {meeting.attendees.length === 1 ? 'attendee' : 'attendees'}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {meeting.meet_link ? (
                    <Button asChild size="sm" variant="secondary">
                      <a href={meeting.meet_link} target="_blank" rel="noopener noreferrer">
                        <Video />
                        Join
                      </a>
                    </Button>
                  ) : null}

                  {meeting.read_only ? (
                    <span
                      title="This event is owned by Google Calendar. Edit it there and the change syncs back."
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-ink-muted"
                    >
                      <Lock className="size-3.5" aria-hidden />
                      Read only
                    </span>
                  ) : (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${meeting.title}`}
                        onClick={() => setEditing(meeting)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${meeting.title}`}
                        onClick={() => setDeleting(meeting)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <MeetingDialog
        open={creating || !!editing}
        meeting={editing}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEditing(null)
          router.refresh()
        }}
      />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleting?.title}&rdquo;?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              {deleting?.google_event_id
                ? 'This also removes the event from Google Calendar and notifies its attendees.'
                : 'This cannot be undone.'}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={onDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MeetingDialog({
  open, meeting, onClose, onSaved,
}: {
  open: boolean
  meeting: Meeting | null
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [location, setLocation] = React.useState('')
  const [startTime, setStartTime] = React.useState('')
  const [endTime, setEndTime] = React.useState('')
  const [attendees, setAttendees] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setFields({})
    if (meeting) {
      setTitle(meeting.title)
      setDescription(meeting.description ?? '')
      setLocation(meeting.location ?? '')
      setStartTime(toLocalInput(meeting.start_time))
      setEndTime(toLocalInput(meeting.end_time))
      setAttendees((meeting.attendees ?? []).map((a) => a.email).join(', '))
    } else {
      const start = new Date()
      start.setHours(start.getHours() + 1, 0, 0, 0)
      const end = new Date(start.getTime() + 60 * 60_000)
      setTitle('')
      setDescription('')
      setLocation('')
      setStartTime(toLocalInput(start.toISOString()))
      setEndTime(toLocalInput(end.toISOString()))
      setAttendees('')
    }
  }, [open, meeting])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const payload = {
      title,
      description: description || undefined,
      location: location || undefined,
      // The input is local wall-clock; `new Date()` interprets it in the
      // browser's zone and toISOString normalises it to the UTC instant we store.
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      attendees: attendees
        .split(/[,\s]+/)
        .map((email) => email.trim())
        .filter(Boolean)
        .map((email) => ({ email })),
    }

    try {
      if (meeting) {
        await apiPatch(`/api/meetings/${meeting.id}`, payload)
        toast.success('Meeting updated')
      } else {
        const result = await apiPost<{ syncedToGoogle: boolean }>('/api/meetings', payload)
        toast.success(
          result.syncedToGoogle ? 'Meeting created and synced to Google' : 'Meeting created'
        )
      }
      onSaved()
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
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{meeting ? 'Edit meeting' : 'New meeting'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Title" error={fields.title} required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Starts" error={fields.startTime} required>
                <DateTimeField
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Ends" error={fields.endTime} required>
                <DateTimeField
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </FormField>
            </div>

            <FormField label="Location" hint="A room, an address, or a video link.">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </FormField>

            <FormField
              label="Attendees"
              error={fields.attendees}
              hint="Comma-separated email addresses. They receive a Google invite when Calendar is connected."
            >
              <Textarea
                rows={2}
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
                placeholder="alice@company.com, bob@company.com"
              />
            </FormField>

            <FormField label="Description">
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {meeting ? 'Save changes' : 'Create meeting'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
