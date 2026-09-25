'use client'

/**
 * The stateful shell around `CalendarView` — and the one home of meetings.
 *
 * The period lives in the URL, not in React state, so a particular month is a
 * link somebody can send — and so paging back re-runs the SERVER query for that
 * period rather than filtering a fixed window in the browser. A calendar that
 * only holds the month it was rendered with quietly shows an empty December.
 *
 * Meetings are scheduled, opened, edited and deleted from here (there is no
 * separate Meetings page any more): the toolbar button or the "+" on any day
 * opens the form, and a meeting on the grid or in the agenda opens its details.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarCheck2, CalendarPlus, RefreshCw, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/patterns'
import { cn } from '@/lib/utils'
import { formatLocal, localDate, timezoneLabel } from '@/lib/time'
import { CalendarView, type CalendarMode } from './calendar-view'
import {
  DeleteMeetingDialog, MeetingDetailDialog, MeetingFormDialog, meetingWhen, type Teammate,
} from './meeting-dialogs'
import { ViewerTimezoneSync } from './viewer-timezone-sync'
import type { CalendarEvent, CalendarMeeting } from '@/lib/calendar-kinds'

export type { Teammate }

export interface GoogleConnectionSummary {
  status: 'connected' | 'needs_reauth' | 'revoked'
  google_email: string | null
}

export function CalendarWorkspace({
  events, anchor, mode, today, timezone, workspaceTimezone, basePath, canManage = false,
  connection = null, calendarConfigured = false, teammates = [], upcoming = [], focusMeeting = null,
}: {
  events: CalendarEvent[]
  anchor: string
  mode: CalendarMode
  today: string
  /** The VIEWER's zone — every time on the page is on this clock. */
  timezone: string
  workspaceTimezone: string
  basePath: string
  /** The org can schedule; employees read. RLS enforces the same split. */
  canManage?: boolean
  connection?: GoogleConnectionSummary | null
  calendarConfigured?: boolean
  teammates?: Teammate[]
  /** The next meetings from now, independent of the month on screen. */
  upcoming?: CalendarMeeting[]
  /** Opened on arrival — the meeting a notification pointed at. */
  focusMeeting?: CalendarMeeting | null
}) {
  const router = useRouter()
  const params = useSearchParams()

  const [viewing, setViewing] = React.useState<CalendarMeeting | null>(focusMeeting)
  const [editing, setEditing] = React.useState<CalendarMeeting | null>(null)
  const [creatingOn, setCreatingOn] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<CalendarMeeting | null>(null)

  const go = React.useCallback(
    (next: { anchor?: string; mode?: CalendarMode }) => {
      const query = new URLSearchParams(params.toString())
      query.delete('meeting')
      if (next.anchor) query.set('date', next.anchor)
      if (next.mode) query.set('view', next.mode)
      router.push(`${basePath}?${query.toString()}`)
    },
    [params, router, basePath]
  )

  const connected = connection?.status === 'connected'

  function closeViewing() {
    setViewing(null)
    // Drop `?meeting=` so a refresh does not reopen what was just closed.
    if (params.get('meeting')) {
      const query = new URLSearchParams(params.toString())
      query.delete('meeting')
      router.replace(query.size ? `${basePath}?${query.toString()}` : basePath, { scroll: false })
    }
  }

  function afterWrite() {
    setCreatingOn(null)
    setEditing(null)
    setDeleting(null)
    setViewing(null)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <ViewerTimezoneSync renderedIn={timezone} />

      {canManage ? (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
          <GoogleStatus connection={connection} configured={calendarConfigured} />
          <Button onClick={() => setCreatingOn(today)} className="shrink-0">
            <CalendarPlus />
            New meeting
          </Button>
        </div>
      ) : null}

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <CalendarView
          events={events}
          anchor={anchor}
          mode={mode}
          today={today}
          timezone={timezone}
          onNavigate={(nextAnchor) => go({ anchor: nextAnchor })}
          onModeChange={(nextMode) => go({ mode: nextMode })}
          onOpenMeeting={setViewing}
          onCreateOn={canManage ? setCreatingOn : undefined}
        />

        <UpcomingMeetings
          meetings={upcoming}
          timezone={timezone}
          today={today}
          canManage={canManage}
          onOpen={setViewing}
          onCreate={() => setCreatingOn(today)}
        />
      </div>

      <p className="text-xs text-ink-muted">
        Times are shown in your time zone, {timezoneLabel(timezone)}.
        {timezone !== workspaceTimezone ? ` The workspace runs on ${workspaceTimezone}.` : ''}
      </p>

      <MeetingDetailDialog
        meeting={viewing}
        timezone={timezone}
        canManage={canManage}
        onClose={closeViewing}
        onEdit={(meeting) => {
          setViewing(null)
          setEditing(meeting)
        }}
        onDelete={(meeting) => {
          setViewing(null)
          setDeleting(meeting)
        }}
      />

      {canManage ? (
        <>
          <MeetingFormDialog
            open={creatingOn !== null || editing !== null}
            meeting={editing}
            initialDate={creatingOn}
            viewerTimezone={timezone}
            workspaceTimezone={workspaceTimezone}
            teammates={teammates}
            connected={connected}
            onClose={() => {
              setCreatingOn(null)
              setEditing(null)
            }}
            onSaved={afterWrite}
          />
          <DeleteMeetingDialog
            meeting={deleting}
            onClose={() => setDeleting(null)}
            onDeleted={afterWrite}
          />
        </>
      ) : null}
    </div>
  )
}

/** Where Google Calendar stands, and the one action that fixes it. */
function GoogleStatus({
  connection, configured,
}: {
  connection: GoogleConnectionSummary | null
  configured: boolean
}) {
  if (connection?.status === 'connected') {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
          <CalendarCheck2 className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">Synced with Google Calendar</p>
          <p className="truncate text-xs text-ink-muted">
            {connection.google_email ?? 'Connected'} · changes flow both ways
          </p>
        </div>
      </div>
    )
  }

  const reauth = connection?.status === 'needs_reauth'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
        <Video className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {reauth ? 'Google Calendar needs reconnecting' : 'Connect Google Calendar'}
          {reauth ? <StatusChip status="needs_reauth" /> : null}
        </p>
        <p className="text-xs text-ink-muted">
          {configured
            ? 'Sync meetings both ways and create Google Meet links automatically.'
            : 'Google Calendar is not configured on this deployment yet.'}
        </p>
      </div>
      {configured ? (
        <Button asChild size="sm" variant="secondary">
          {/* A plain navigation: the route starts OAuth and redirects to Google. */}
          <a href="/api/integrations/google/connect">
            <RefreshCw />
            {reauth ? 'Reconnect' : 'Connect'}
          </a>
        </Button>
      ) : (
        <Button asChild size="sm" variant="ghost">
          <Link href="/org/settings/integrations">Details</Link>
        </Button>
      )}
    </div>
  )
}

function UpcomingMeetings({
  meetings, timezone, today, canManage, onOpen, onCreate,
}: {
  meetings: CalendarMeeting[]
  timezone: string
  today: string
  canManage: boolean
  onOpen: (meeting: CalendarMeeting) => void
  onCreate: () => void
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-sm font-semibold">Upcoming meetings</p>
        <span className="text-xs text-ink-muted">{meetings.length ? `${meetings.length}` : ''}</span>
      </div>
      {meetings.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-ink-muted">Nothing scheduled.</p>
          {canManage ? (
            <Button size="sm" variant="secondary" className="mt-3" onClick={onCreate}>
              <CalendarPlus />
              Schedule one
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
          {meetings.map((meeting) => {
            const day = meeting.all_day
              ? meeting.start_time.slice(0, 10)
              : localDate(meeting.start_time, timezone)
            const zone = meeting.all_day ? 'UTC' : timezone
            return (
              <li key={meeting.id} className="flex items-center gap-3 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => onOpen(meeting)}
                  className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
                >
                  <span
                    className={cn(
                      'tabular grid w-11 shrink-0 rounded-lg py-1 text-center',
                      day === today ? 'bg-brand-600 text-white' : 'bg-page'
                    )}
                  >
                    <span className="text-[9px] font-semibold uppercase tracking-wider opacity-80">
                      {formatLocal(meeting.start_time, zone, 'MMM')}
                    </span>
                    <span className="text-base font-bold leading-tight">
                      {formatLocal(meeting.start_time, zone, 'd')}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{meeting.title}</span>
                    <span className="tabular block truncate text-xs text-ink-muted">
                      {meetingWhen(meeting, timezone)}
                    </span>
                  </span>
                </button>
                {meeting.meet_link ? (
                  <Button asChild size="sm" variant="secondary" className="shrink-0">
                    <a
                      href={meeting.meet_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Join ${meeting.title}`}
                    >
                      <Video />
                      Join
                    </a>
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
