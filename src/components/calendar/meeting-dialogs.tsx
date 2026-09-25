'use client'

/**
 * Everything you can do to a meeting, as dialogs over the calendar.
 *
 * These used to live on a separate Meetings page. The calendar is where people
 * decide WHEN to meet — next to the leave, birthdays and deadlines that decide
 * it — so creating, reading, editing and deleting a meeting all happen here
 * now, and the grid is the one place meetings live.
 *
 * TIMES ARE ENTERED ON A CHOSEN CLOCK. The form defaults to the viewer's own
 * zone, because that is the clock a person means when they type "6:30 PM",
 * and names the zone right under the fields. The organiser can switch it (to
 * schedule in the client's zone, say). The instant stored is absolute either
 * way; the zone travels to Google so the invite reads on the same clock.
 */

import * as React from 'react'
import Link from 'next/link'
import {
  CalendarDays, Check, ExternalLink, FileText, Lock, MapPin, Pencil, Trash2,
  UserRound, Users, Video, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { StatusChip } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Textarea, DateTimeField, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter, Switch,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { formatLocal, fromZonedInput, timezoneLabel, toZonedInput } from '@/lib/time'
import { COMMON_TIMEZONES } from '@/lib/timezones'
import type { CalendarMeeting, CalendarMeetingAttendee } from '@/lib/calendar-kinds'

export interface Teammate {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
}

/** "Mon 22 Sep 2026, 18:30 – 19:30", or the dates of an all-day event. */
export function meetingWhen(meeting: CalendarMeeting, timezone: string, long = false): string {
  if (meeting.all_day) {
    // Dates, not instants (048) — read in UTC, where they were written.
    const first = formatLocal(meeting.start_time, 'UTC', long ? 'EEEE d MMMM yyyy' : 'EEE d MMM')
    const last = formatLocal(meeting.end_time, 'UTC', long ? 'EEEE d MMMM yyyy' : 'EEE d MMM')
    return first === last ? `${first} · all day` : `${first} – ${last} · all day`
  }
  const day = formatLocal(meeting.start_time, timezone, long ? 'EEEE d MMMM yyyy' : 'EEE d MMM')
  const start = formatLocal(meeting.start_time, timezone, 'h:mm a')
  const sameDay =
    formatLocal(meeting.start_time, timezone, 'yyyy-MM-dd') ===
    formatLocal(meeting.end_time, timezone, 'yyyy-MM-dd')
  const end = formatLocal(meeting.end_time, timezone, sameDay ? 'h:mm a' : 'EEE d MMM, h:mm a')
  return `${day}, ${start} – ${end}`
}

/**
 * The read-only view of one meeting.
 *
 * Deliberately NOT the edit form. Most opens are someone checking where a
 * meeting is or who is coming, and a form for that invites an accidental save —
 * doubly so for Google-owned rows, which cannot be saved from here at all.
 */
export function MeetingDetailDialog({
  meeting, timezone, canManage, onClose, onEdit, onDelete,
}: {
  meeting: CalendarMeeting | null
  timezone: string
  canManage: boolean
  onClose: () => void
  onEdit: (meeting: CalendarMeeting) => void
  onDelete: (meeting: CalendarMeeting) => void
}) {
  const editable = canManage && meeting && !meeting.read_only
  return (
    <Dialog open={!!meeting} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {meeting ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{meeting.title}</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-4">
              {meeting.source === 'google' || meeting.read_only ? (
                <div className="flex flex-wrap items-center gap-2">
                  {meeting.source === 'google' ? (
                    <StatusChip status="info" tone="info" label="From Google Calendar" />
                  ) : null}
                  {meeting.read_only && canManage ? (
                    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                      <Lock className="size-3.5" aria-hidden />
                      Read only — edit it in Google Calendar
                    </span>
                  ) : null}
                </div>
              ) : null}

              <DetailRow icon={CalendarDays} label="When">
                <span className="tabular">{meetingWhen(meeting, timezone, true)}</span>
                {meeting.all_day ? null : (
                  <span className="block text-xs text-ink-muted">
                    Your time — {timezoneLabel(timezone)}
                  </span>
                )}
              </DetailRow>

              {meeting.organizer_name ? (
                <DetailRow icon={UserRound} label="Organiser">
                  {meeting.organizer_name}
                </DetailRow>
              ) : null}

              {meeting.location ? (
                <DetailRow icon={MapPin} label="Where">
                  <span className="break-words">{meeting.location}</span>
                </DetailRow>
              ) : null}

              {meeting.meet_link ? (
                <DetailRow icon={Video} label="Video call">
                  <a
                    href={meeting.meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 break-all font-medium text-brand-ink hover:underline"
                  >
                    {meeting.meet_link}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  </a>
                </DetailRow>
              ) : null}

              {meeting.description ? (
                <DetailRow icon={FileText} label="Description">
                  <span className="whitespace-pre-line break-words">{meeting.description}</span>
                </DetailRow>
              ) : null}

              {meeting.attendees.length ? (
                <DetailRow icon={Users} label={`Attendees (${meeting.attendees.length})`}>
                  <ul className="space-y-1">
                    {meeting.attendees.map((attendee) => (
                      <li key={attendee.email} className="min-w-0 truncate">
                        {attendee.name ? (
                          <>
                            {attendee.name}{' '}
                            <span className="text-ink-muted">{attendee.email}</span>
                          </>
                        ) : (
                          attendee.email
                        )}
                      </li>
                    ))}
                  </ul>
                </DetailRow>
              ) : null}
            </DialogBody>
            <DialogFooter>
              {editable ? (
                <Button
                  variant="ghost"
                  className="mr-auto text-red-600 hover:text-red-700"
                  onClick={() => onDelete(meeting)}
                >
                  <Trash2 />
                  Delete
                </Button>
              ) : null}
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              {editable ? (
                <Button variant="secondary" onClick={() => onEdit(meeting)}>
                  <Pencil />
                  Edit
                </Button>
              ) : null}
              {meeting.meet_link ? (
                <Button asChild>
                  <a href={meeting.meet_link} target="_blank" rel="noopener noreferrer">
                    <Video />
                    Join
                  </a>
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DetailRow({
  icon: Icon, label, children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

export function DeleteMeetingDialog({
  meeting, onClose, onDeleted,
}: {
  meeting: CalendarMeeting | null
  onClose: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = React.useState(false)

  async function onDelete() {
    if (!meeting) return
    setBusy(true)
    try {
      await apiDelete(`/api/meetings/${meeting.id}`)
      toast.success('Meeting deleted')
      onDeleted()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!meeting} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{meeting?.title}&rdquo;?</DialogTitle>
        </DialogHeader>
        <DialogBody className="pb-4">
          <p className="text-sm text-ink-muted">
            {meeting?.google_event_id
              ? 'This also removes the event from Google Calendar and notifies its attendees.'
              : 'This cannot be undone.'}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={onDelete}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Every zone worth offering: the viewer's, the workspace's, then the common list. */
function zoneOptions(viewer: string, workspace: string, current: string): string[] {
  return Array.from(new Set([viewer, workspace, current, ...COMMON_TIMEZONES].filter(Boolean)))
}

export function MeetingFormDialog({
  open, meeting, initialDate, viewerTimezone, workspaceTimezone, teammates, connected,
  onClose, onSaved,
}: {
  open: boolean
  meeting: CalendarMeeting | null
  /** `YYYY-MM-DD` the person clicked on the grid, for a new meeting. */
  initialDate: string | null
  viewerTimezone: string
  workspaceTimezone: string
  teammates: Teammate[]
  /** Google Calendar is connected, so Google can mint a Meet room. */
  connected: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [zone, setZone] = React.useState(viewerTimezone)
  const [startTime, setStartTime] = React.useState('')
  const [endTime, setEndTime] = React.useState('')
  const [addMeetLink, setAddMeetLink] = React.useState(true)
  // A link typed in by hand: always on edit, and on create whenever Google is
  // not the one making the room (not connected, or the switch is off).
  const [meetLink, setMeetLink] = React.useState('')
  const [attendees, setAttendees] = React.useState<CalendarMeetingAttendee[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setFields({})
    setZone(viewerTimezone)
    if (meeting) {
      setTitle(meeting.title)
      setDescription(meeting.description ?? '')
      setStartTime(toZonedInput(meeting.start_time, viewerTimezone))
      setEndTime(toZonedInput(meeting.end_time, viewerTimezone))
      setAddMeetLink(!!meeting.meet_link)
      setMeetLink(meeting.meet_link ?? '')
      setAttendees(meeting.attendees)
    } else {
      /*
       * A day clicked on the grid opens at 10:00 that day; the toolbar button
       * opens at the next whole hour. Both on the viewer's clock — the one the
       * form is showing.
       */
      const nextHour = new Date(Date.now() + 60 * 60_000)
      const today = toZonedInput(new Date(), viewerTimezone).slice(0, 10)
      const start =
        initialDate && initialDate !== today
          ? `${initialDate}T10:00`
          : `${toZonedInput(nextHour, viewerTimezone).slice(0, 13)}:00`
      const startInstant = fromZonedInput(start, viewerTimezone)
      setTitle('')
      setDescription('')
      setStartTime(start)
      setEndTime(
        startInstant
          ? toZonedInput(new Date(new Date(startInstant).getTime() + 60 * 60_000), viewerTimezone)
          : ''
      )
      setAddMeetLink(connected)
      setMeetLink('')
      setAttendees([])
    }
  }, [open, meeting, initialDate, viewerTimezone, connected])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    /*
     * The fields hold wall-clock time on the CHOSEN zone's clock, so that is the
     * zone they are read back in before being stored as a UTC instant.
     */
    const startInstant = fromZonedInput(startTime, zone)
    const endInstant = fromZonedInput(endTime, zone)

    if (!startInstant || !endInstant) {
      setError('Please give the meeting a start and an end time.')
      return
    }
    if (new Date(endInstant) <= new Date(startInstant)) {
      setFields({ endTime: 'The meeting must end after it starts' })
      setError('The meeting must end after it starts.')
      return
    }

    setSubmitting(true)
    const payload = {
      title,
      description: description || undefined,
      startTime: startInstant,
      endTime: endInstant,
      timezone: zone,
      // Google mints a room only when it can and nobody pasted one. A request
      // it cannot fulfil is refused by the server rather than dropped silently.
      addMeetLink: !meeting && connected && addMeetLink && !meetLink.trim(),
      // On edit the box is always shown, so an empty one clears the link.
      meetLink: meeting ? meetLink.trim() : meetLink.trim() || undefined,
      attendees: attendees.map((a) => ({ email: a.email, name: a.name || undefined })),
    }

    try {
      if (meeting) {
        await apiPatch(`/api/meetings/${meeting.id}`, payload)
        toast.success('Meeting updated')
      } else {
        const result = await apiPost<{
          syncedToGoogle: boolean
          meetLink: string | null
          warning: string | null
        }>('/api/meetings', payload)
        if (result.warning) {
          toast.warning(result.warning, { duration: 10_000 })
        } else {
          toast.success(
            result.syncedToGoogle
              ? result.meetLink
                ? 'Meeting created — invites with the Meet link are on their way'
                : 'Meeting created and synced to Google'
              : result.meetLink
                ? 'Meeting created — attendees were sent the link'
                : 'Meeting created'
          )
        }
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

  function onStartChange(next: string) {
    setStartTime(next)
    // Keep the gap the user already chose rather than snapping to an hour, and
    // never leave an end time before its start.
    const from = fromZonedInput(next, zone)
    const previousFrom = fromZonedInput(startTime, zone)
    const to = fromZonedInput(endTime, zone)
    if (!from) return
    const span =
      previousFrom && to ? new Date(to).getTime() - new Date(previousFrom).getTime() : 0
    const gap = span > 0 ? span : 60 * 60_000
    setEndTime(toZonedInput(new Date(new Date(from).getTime() + gap), zone))
  }

  const startInstant = fromZonedInput(startTime, zone)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !submitting && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{meeting ? 'Edit meeting' : 'New meeting'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Title" error={fields.title} required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                placeholder="Weekly sync"
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Starts" error={fields.startTime} required>
                <DateTimeField
                  value={startTime}
                  onChange={(e) => onStartChange(e.target.value)}
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

            {/*
              Which clock these times are on. The default is the person's own,
              and when they pick another the form says what that is for them —
              the one sentence that stops "6:30" meaning two different things.
            */}
            <FormField
              label="Time zone"
              hint={
                zone !== viewerTimezone && startInstant
                  ? `That is ${formatLocal(startInstant, viewerTimezone, 'EEE d MMM, h:mm a')} your time (${viewerTimezone}).`
                  : undefined
              }
            >
              <Select
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                aria-label="Time zone"
                options={zoneOptions(viewerTimezone, workspaceTimezone, zone).map((value) => ({
                  value,
                  label:
                    value === viewerTimezone
                      ? `${timezoneLabel(value)} — your time`
                      : value === workspaceTimezone
                        ? `${timezoneLabel(value)} — workspace`
                        : timezoneLabel(value),
                }))}
              />
            </FormField>

            {/*
              THE LINK. Google mints a Meet room only during create, so an edit
              offers the link itself (paste, replace or clear). On create: the
              Meet switch when Calendar is connected; otherwise a plain notice
              that it is not, with a way to connect and a box to paste a link.
            */}
            {meeting ? (
              <FormField
                label="Meeting link"
                error={fields.meetLink}
                hint="Google Meet, Zoom or Teams. Leave empty for an in-person meeting."
              >
                <Input
                  type="url"
                  value={meetLink}
                  onChange={(e) => setMeetLink(e.target.value)}
                  placeholder="https://meet.google.com/abc-defg-hij"
                />
              </FormField>
            ) : !connected ? (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="flex items-start justify-between gap-3">
                  <p className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
                    <Video className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      <span className="font-medium">Google Calendar isn&apos;t connected.</span>{' '}
                      Connect it to create Meet links automatically, or paste a link below.
                    </span>
                  </p>
                  <Button asChild size="sm" variant="secondary" className="shrink-0">
                    <Link href="/org/settings/integrations">Connect</Link>
                  </Button>
                </div>
                <FormField
                  label="Meeting link"
                  error={fields.meetLink}
                  hint="Optional. Sent to every attendee. Leave empty for an in-person meeting."
                >
                  <Input
                    type="url"
                    value={meetLink}
                    onChange={(e) => setMeetLink(e.target.value)}
                    placeholder="https://meet.google.com/abc-defg-hij"
                  />
                </FormField>
              </div>
            ) : (
              <label className="flex items-start justify-between gap-4 rounded-lg border border-line p-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Video className="size-4 text-ink-muted" aria-hidden />
                    Add a Google Meet link
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Google creates the room and puts it in every invite. Turn it off
                    for an in-person meeting.
                  </span>
                </span>
                <Switch
                  checked={addMeetLink}
                  onCheckedChange={setAddMeetLink}
                  aria-label="Add a Google Meet link"
                />
              </label>
            )}

            {!meeting && connected && !addMeetLink ? (
              <FormField
                label="Meeting link"
                error={fields.meetLink}
                hint="Optional — paste a Zoom or Teams link, or leave empty for an in-person meeting."
              >
                <Input
                  type="url"
                  value={meetLink}
                  onChange={(e) => setMeetLink(e.target.value)}
                  placeholder="https://zoom.us/j/…"
                />
              </FormField>
            ) : null}

            <FormField
              label="Attendees"
              error={fields.attendees}
              hint="Pick teammates, or add anyone else by email. Teammates are notified with the time and link; everyone gets a Google invite when Calendar is connected."
            >
              <AttendeePicker teammates={teammates} value={attendees} onChange={setAttendees} />
            </FormField>

            <FormField label="Description">
              <Textarea
                rows={3}
                value={description}
                maxLength={4000}
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

/**
 * Attendees are teammates far more often than outsiders, so the picker leads
 * with the workspace roster and keeps a plain email box for everyone else.
 * Selection is keyed by email because that is what Google Calendar invites on,
 * and what an externally-added guest has instead of a profile.
 */
function AttendeePicker({
  teammates, value, onChange,
}: {
  teammates: Teammate[]
  value: CalendarMeetingAttendee[]
  onChange: (next: CalendarMeetingAttendee[]) => void
}) {
  const [query, setQuery] = React.useState('')
  const [guest, setGuest] = React.useState('')

  const chosen = new Set(value.map((a) => a.email.toLowerCase()))

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return teammates.filter((t) => {
      if (!t.email) return false
      if (!q) return true
      return (t.full_name ?? '').toLowerCase().includes(q) || t.email.toLowerCase().includes(q)
    })
  }, [teammates, query])

  function toggle(mate: Teammate) {
    if (!mate.email) return
    const email = mate.email
    if (chosen.has(email.toLowerCase())) {
      onChange(value.filter((a) => a.email.toLowerCase() !== email.toLowerCase()))
    } else {
      onChange([...value, { email, name: mate.full_name ?? undefined }])
    }
  }

  function addGuest() {
    const email = guest.trim()
    // Shape only — the server's zod schema is the real check.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    if (!chosen.has(email.toLowerCase())) onChange([...value, { email }])
    setGuest('')
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((a) => (
            <li
              key={a.email}
              className="flex items-center gap-1 rounded-full bg-page py-1 pl-2.5 pr-1 text-xs"
            >
              <span className="max-w-[14rem] truncate">{a.name || a.email}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.email !== a.email))}
                aria-label={`Remove ${a.name || a.email}`}
                className="rounded-full p-0.5 text-ink-muted hover:bg-card hover:text-ink"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search teammates"
        aria-label="Search teammates"
      />

      <div className="max-h-44 overflow-y-auto rounded-lg border border-line">
        {matches.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-ink-muted">No teammates match that search.</p>
        ) : (
          <ul>
            {matches.map((mate) => {
              const selected = chosen.has((mate.email ?? '').toLowerCase())
              return (
                <li key={mate.id}>
                  <button
                    type="button"
                    onClick={() => toggle(mate)}
                    aria-pressed={selected}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-page"
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                        selected ? 'border-brand bg-brand text-white' : 'border-line'
                      }`}
                    >
                      {selected ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{mate.full_name || mate.email}</span>
                    {mate.full_name ? (
                      <span className="hidden min-w-0 max-w-[12rem] truncate text-xs text-ink-muted sm:block">
                        {mate.email}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          type="email"
          value={guest}
          onChange={(e) => setGuest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Otherwise Enter submits the meeting form instead of adding a guest.
              e.preventDefault()
              addGuest()
            }
          }}
          placeholder="Add someone outside the workspace"
          aria-label="Guest email address"
        />
        <Button type="button" variant="secondary" onClick={addGuest} disabled={!guest.trim()}>
          Add
        </Button>
      </div>
    </div>
  )
}

