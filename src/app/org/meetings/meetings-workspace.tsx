'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  CalendarDays, Check, ExternalLink, FileText, Lock, MapPin, Pencil, Plus, Trash2,
  Users, Video, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, DateTimeField } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
  Switch, Tabs, TabsList, TabsTrigger,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { formatLocal, fromZonedInput, timezoneLabel, toZonedInput } from '@/lib/time'
import type { Meeting, MeetingAttendee } from '@/types/db'

export interface Teammate {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
}

export function MeetingsWorkspace({
  meetings, connected, timezone, teammates,
}: {
  meetings: Meeting[]
  connected: boolean
  timezone: string
  teammates: Teammate[]
}) {
  const router = useRouter()
  const [tab, setTab] = React.useState<'upcoming' | 'past'>('upcoming')
  const [editing, setEditing] = React.useState<Meeting | null>(null)
  const [viewing, setViewing] = React.useState<Meeting | null>(null)
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
                {/*
                  A button rather than a link: the detail lives in a dialog, so
                  there is no URL to navigate to. Only the summary area is
                  clickable — Join, Edit and Delete sit in the sibling column so
                  they are never swallowed by it.
                */}
                <button
                  type="button"
                  onClick={() => setViewing(meeting)}
                  aria-label={`Open ${meeting.title}`}
                  className="flex min-w-0 flex-1 items-start gap-3.5 rounded-lg text-left focus-ring"
                >
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
                </button>

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

      <MeetingDetailDialog
        meeting={viewing}
        timezone={timezone}
        onClose={() => setViewing(null)}
        onEdit={(meeting) => {
          setViewing(null)
          setEditing(meeting)
        }}
      />

      <MeetingDialog
        open={creating || !!editing}
        meeting={editing}
        timezone={timezone}
        teammates={teammates}
        connected={connected}
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

/**
 * The read-only view of one meeting.
 *
 * Deliberately NOT the edit form. Most opens are someone checking where a
 * meeting is or who is coming, and a form for that invites an accidental save —
 * doubly so for Google-owned rows, which cannot be saved from here at all.
 */
function MeetingDetailDialog({
  meeting, timezone, onClose, onEdit,
}: {
  meeting: Meeting | null
  timezone: string
  onClose: () => void
  onEdit: (meeting: Meeting) => void
}) {
  return (
    <Dialog open={!!meeting} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {meeting ? (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{meeting.title}</DialogTitle>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                {meeting.source === 'google' ? (
                  <StatusChip status="info" tone="info" label="From Google" />
                ) : null}
                {meeting.read_only ? (
                  <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                    <Lock className="size-3.5" aria-hidden />
                    Read only — edit it in Google Calendar
                  </span>
                ) : null}
              </div>

              <DetailRow icon={CalendarDays} label="When">
                <span className="tabular">
                  {formatLocal(meeting.start_time, timezone, 'EEEE d MMMM yyyy, HH:mm')} –{' '}
                  {formatLocal(meeting.end_time, timezone, 'HH:mm')}
                </span>
                <span className="block text-xs text-ink-muted">{timezone}</span>
              </DetailRow>

              {meeting.location ? (
                <DetailRow icon={MapPin} label="Where">
                  {meeting.location}
                </DetailRow>
              ) : null}

              {meeting.meet_link ? (
                <DetailRow icon={Video} label="Video call">
                  <a
                    href={meeting.meet_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 break-all font-medium text-brand-600 hover:underline"
                  >
                    {meeting.meet_link}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                  </a>
                </DetailRow>
              ) : null}

              {meeting.description ? (
                <DetailRow icon={FileText} label="Description">
                  <span className="whitespace-pre-line">{meeting.description}</span>
                </DetailRow>
              ) : null}

              {meeting.attendees?.length ? (
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
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              {meeting.read_only ? null : (
                <Button variant="secondary" onClick={() => onEdit(meeting)}>
                  <Pencil />
                  Edit
                </Button>
              )}
              {meeting.meet_link ? (
                <Button asChild>
                  <a href={meeting.meet_link} target="_blank" rel="noopener noreferrer">
                    <Video />
                    Join meeting
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

function MeetingDialog({
  open, meeting, timezone, teammates, connected, onClose, onSaved,
}: {
  open: boolean
  meeting: Meeting | null
  timezone: string
  teammates: Teammate[]
  /** Google Calendar is connected, so Google can mint a Meet room. */
  connected: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [startTime, setStartTime] = React.useState('')
  const [endTime, setEndTime] = React.useState('')
  const [addMeetLink, setAddMeetLink] = React.useState(true)
  // A link typed in by hand: always on edit, and on create whenever Google is
  // not the one making the room (not connected, or the switch is off).
  const [meetLink, setMeetLink] = React.useState('')
  const [attendees, setAttendees] = React.useState<MeetingAttendee[]>([])
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
      setStartTime(toZonedInput(meeting.start_time, timezone))
      setEndTime(toZonedInput(meeting.end_time, timezone))
      setAddMeetLink(!!meeting.meet_link)
      setMeetLink(meeting.meet_link ?? '')
      setAttendees(meeting.attendees ?? [])
    } else {
      /*
       * Default to the next whole hour IN THE ORG'S ZONE.
       *
       * Built by rounding the zoned wall clock rather than the browser's, so an
       * admin travelling (or on a laptop still set to another country) opens the
       * form on the workspace's next hour, which is the one everyone else sees.
       */
      const nextHour = new Date(Date.now() + 60 * 60_000)
      const start = `${toZonedInput(nextHour, timezone).slice(0, 13)}:00`
      const startInstant = fromZonedInput(start, timezone)
      setTitle('')
      setDescription('')
      setStartTime(start)
      setEndTime(
        startInstant
          ? toZonedInput(new Date(new Date(startInstant).getTime() + 60 * 60_000), timezone)
          : ''
      )
      setAddMeetLink(connected)
      setMeetLink('')
      setAttendees([])
    }
  }, [open, meeting, timezone, connected])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    /*
     * The fields hold wall-clock time in the WORKSPACE'S zone, so that is the
     * zone they must be read back in before being stored as a UTC instant.
     * Reading them in the browser's zone is what used to shift every meeting for
     * anyone whose machine did not match the workspace.
     */
    const startInstant = fromZonedInput(startTime, timezone)
    const endInstant = fromZonedInput(endTime, timezone)

    if (!startInstant || !endInstant) {
      setError('Please give the meeting a start and an end time.')
      setSubmitting(false)
      return
    }

    const payload = {
      title,
      description: description || undefined,
      startTime: startInstant,
      endTime: endInstant,
      timezone,
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
                  onChange={(e) => {
                    const next = e.target.value
                    setStartTime(next)
                    // Keep the gap the user already chose rather than snapping to
                    // an hour, and never leave an end time before its start.
                    const from = fromZonedInput(next, timezone)
                    const previousFrom = fromZonedInput(startTime, timezone)
                    const to = fromZonedInput(endTime, timezone)
                    if (!from) return
                    const span =
                      previousFrom && to
                        ? new Date(to).getTime() - new Date(previousFrom).getTime()
                        : 0
                    const gap = span > 0 ? span : 60 * 60_000
                    setEndTime(toZonedInput(new Date(new Date(from).getTime() + gap), timezone))
                  }}
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
              Which clock these times are on. Without it the form is ambiguous
              for anyone whose own timezone differs from the workspace's — and
              they are the people most likely to get it wrong.
            */}
            <p className="-mt-1 text-xs text-ink-muted">
              Times are in the workspace timezone, {timezoneLabel(timezone)}.
            </p>

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
              /*
                No calendar, so no automatic room — said up front, with the two
                ways forward, instead of a switch that would do nothing.
              */
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="flex items-start gap-2 text-sm text-amber-900">
                    <Video className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>
                      <span className="font-medium">Google Calendar isn&apos;t connected.</span>{' '}
                      A Meet link can&apos;t be created automatically — connect your calendar, or
                      paste a link below.
                    </span>
                  </p>
                  <Button asChild size="sm" variant="secondary" className="shrink-0">
                    <Link href="/org/settings/integrations">Connect calendar</Link>
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
              <AttendeePicker
                teammates={teammates}
                value={attendees}
                onChange={setAttendees}
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
  value: MeetingAttendee[]
  onChange: (next: MeetingAttendee[]) => void
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
    if (!email || !email.includes('@')) return
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
                    <span className="min-w-0 flex-1 truncate">
                      {mate.full_name || mate.email}
                    </span>
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
