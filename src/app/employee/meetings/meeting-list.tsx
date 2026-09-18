'use client'

/**
 * The employee's meeting list, with a details view per meeting.
 *
 * Rows used to be static cards: clicking one did nothing, and a meeting without
 * a Meet link offered no way in at all. Now every row opens the full details —
 * when, where, who, the description and the join link.
 */

import * as React from 'react'
import { Check, Clock, Copy, MapPin, Users, Video } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'

export interface MeetingRow {
  id: string
  title: string
  description: string | null
  location: string | null
  joinUrl: string | null
  month: string
  day: string
  when: string
  attendees: string[]
  organizer: string | null
}

export function MeetingList({ meetings }: { meetings: MeetingRow[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const open = meetings.find((m) => m.id === openId) ?? null

  return (
    <>
      <ul className="space-y-2.5">
        {meetings.map((meeting) => (
          <li key={meeting.id}>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(meeting.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setOpenId(meeting.id)
                }
              }}
              className="focus-ring flex cursor-pointer flex-col gap-3 p-4 transition hover:border-brand-200 hover:bg-page/60 sm:flex-row sm:items-center"
            >
              <span className="tabular grid w-14 shrink-0 rounded-lg bg-page py-2 text-center">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                  {meeting.month}
                </span>
                <span className="text-lg font-bold leading-tight">{meeting.day}</span>
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{meeting.title}</p>
                <p className="tabular mt-0.5 text-[13px] text-ink-muted">{meeting.when}</p>
                {meeting.location ? (
                  <p className="mt-0.5 truncate text-[13px] text-ink-muted">{meeting.location}</p>
                ) : null}
              </div>

              {meeting.joinUrl ? (
                <Button
                  asChild
                  size="sm"
                  className="shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">
                    <Video />
                    Join
                  </a>
                </Button>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent>
          {open ? <MeetingDetails meeting={open} /> : null}
        </DialogContent>
      </Dialog>
    </>
  )
}

function MeetingDetails({ meeting }: { meeting: MeetingRow }) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    if (!meeting.joinUrl) return
    try {
      await navigator.clipboard.writeText(meeting.joinUrl)
      setCopied(true)
      toast.success('Link copied')
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy the link')
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{meeting.title}</DialogTitle>
        {meeting.organizer ? (
          <DialogDescription>Organized by {meeting.organizer}</DialogDescription>
        ) : null}
      </DialogHeader>

      <DialogBody className="space-y-4 text-sm">
        <Detail icon={Clock}>{meeting.when}</Detail>
        {meeting.location ? <Detail icon={MapPin}>{meeting.location}</Detail> : null}

        <Detail icon={Video}>
          {meeting.joinUrl ? (
            <div className="flex min-w-0 items-center gap-2">
              <a
                href={meeting.joinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate font-medium text-brand-600 hover:underline"
              >
                {meeting.joinUrl}
              </a>
              <button
                type="button"
                onClick={copy}
                aria-label="Copy meeting link"
                className="focus-ring shrink-0 rounded p-1 text-ink-muted hover:text-ink"
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </button>
            </div>
          ) : (
            <span className="text-ink-muted">No online meeting link was added.</span>
          )}
        </Detail>

        {meeting.attendees.length ? (
          <Detail icon={Users}>
            <div className="flex flex-wrap gap-1.5">
              {meeting.attendees.map((a) => (
                <span
                  key={a}
                  className="rounded-full bg-page px-2.5 py-0.5 text-xs ring-1 ring-inset ring-line"
                >
                  {a}
                </span>
              ))}
            </div>
          </Detail>
        ) : null}

        {meeting.description ? (
          <div className="rounded-lg border border-line bg-page px-3.5 py-3">
            <p className="whitespace-pre-wrap leading-relaxed">{meeting.description}</p>
          </div>
        ) : null}
      </DialogBody>

      {meeting.joinUrl ? (
        <DialogFooter>
          <Button asChild>
            <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">
              <Video />
              Join meeting
            </a>
          </Button>
        </DialogFooter>
      ) : null}
    </>
  )
}

function Detail({ icon: Icon, children }: { icon: typeof Clock; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
