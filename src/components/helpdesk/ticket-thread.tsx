'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Send, FileText, Paperclip, Building2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea, Select } from '@/components/ui/input'
import { FormError } from '@/components/ui/form-field'
import { StatusChip } from '@/components/ui/patterns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { AttachmentDrop, type Attachment } from '@/components/timesheet/attachment-drop'
import { apiPost, apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { TICKET_STATUSES } from '@/lib/schemas'
import { cn, initials, humanize } from '@/lib/utils'
import type { TicketPriority, TicketStatus, UserRole } from '@/types/db'

export interface ThreadTicket {
  id: string
  code: string
  subject: string
  description: string
  priority: TicketPriority
  status: TicketStatus
  attachmentKey: string | null
  attachmentName: string | null
  createdAt: string
  employeeName: string
  employeePhoto: string | null
  employeeId: string
}

export interface ThreadMessage {
  id: string
  authorRole: UserRole
  authorName: string
  authorPhoto: string | null
  body: string
  attachmentKey: string | null
  attachmentName: string | null
  createdAt: string
}

/**
 * The conversation, from either side.
 *
 * ONE COMPONENT FOR BOTH PORTALS. The employee and the org are looking at the
 * same thread and must read it identically; the only differences are who can
 * change the status (the org) and, when the org uploads an attachment, who it
 * has to be readable by. Two components would be two chances for the two sides
 * to disagree about what was said.
 *
 * The org's attachment is uploaded WITH the ticket's `employeeId`, which is what
 * puts the employee on the `documents` row and therefore lets `/api/files/view`
 * hand them the file. Without it the org could attach something the person it
 * was for could not open.
 */
export function TicketThread({
  ticket, messages, viewer, timezone, orgName,
}: {
  ticket: ThreadTicket
  messages: ThreadMessage[]
  viewer: 'employee' | 'org'
  timezone: string
  orgName: string
}) {
  const router = useRouter()
  const [body, setBody] = React.useState('')
  const [attachment, setAttachment] = React.useState<Attachment | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [sending, setSending] = React.useState(false)
  const [changingStatus, setChangingStatus] = React.useState(false)

  const closed = ticket.status === 'closed'

  async function reply(event: React.FormEvent) {
    event.preventDefault()
    if (!body.trim()) return
    setError(null)
    setSending(true)
    try {
      await apiPost(`/api/tickets/${ticket.id}/messages`, {
        body,
        attachmentKey: attachment?.key,
        attachmentName: attachment?.name,
      })
      setBody('')
      setAttachment(null)
      toast.success('Reply sent')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setSending(false)
    }
  }

  async function changeStatus(status: string) {
    setChangingStatus(true)
    try {
      await apiPatch(`/api/tickets/${ticket.id}`, { status })
      toast.success(`Marked ${humanize(status).toLowerCase()}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setChangingStatus(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-5">
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>{ticket.subject}</CardTitle>
              <p className="mt-1 text-xs text-ink-muted">
                {ticket.employeeName} · {formatLocal(ticket.createdAt, timezone, 'd MMM yyyy, HH:mm')}
              </p>
            </div>
            <StatusChip status={ticket.priority} label={`${humanize(ticket.priority)} priority`} />
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{ticket.description}</p>
            {ticket.attachmentKey ? (
              <AttachmentLink keyName={ticket.attachmentKey} name={ticket.attachmentName} />
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {messages.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
              No replies yet.
            </p>
          ) : (
            messages.map((message) => (
              <Message key={message.id} message={message} viewer={viewer} timezone={timezone} orgName={orgName} />
            ))
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{closed ? 'This ticket is closed' : 'Add a reply'}</CardTitle>
          </CardHeader>
          <CardContent>
            {closed ? (
              <p className="text-sm text-ink-muted">
                {viewer === 'employee'
                  ? 'Raise a new ticket if you still need help with this.'
                  : 'Reopen it by setting the status back to in progress.'}
              </p>
            ) : (
              <form onSubmit={reply} className="space-y-4">
                <FormError message={error} />
                <Textarea
                  rows={4}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder={
                    viewer === 'org'
                      ? 'Reply to the employee…'
                      : 'Add more detail, or answer a question…'
                  }
                />
                <AttachmentDrop
                  value={attachment}
                  onChange={setAttachment}
                  label="Attachment"
                  hint="Optional — a screenshot, a form, a log file."
                  employeeId={viewer === 'org' ? ticket.employeeId : undefined}
                />
                <Button type="submit" loading={sending} disabled={!body.trim()}>
                  <Send />
                  Send reply
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Detail label="Ticket ID" value={<span className="tabular">{ticket.code}</span>} />
            <Detail label="Status" value={<StatusChip status={ticket.status} />} />
            <Detail
              label="Priority"
              value={<StatusChip status={ticket.priority} label={humanize(ticket.priority)} />}
            />
            <Detail label="Raised by" value={ticket.employeeName} />
            <Detail
              label="Created"
              value={formatLocal(ticket.createdAt, timezone, 'd MMM yyyy, HH:mm')}
            />
          </CardContent>
        </Card>

        {viewer === 'org' ? (
          <Card>
            <CardHeader>
              <CardTitle>Change status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select
                value={ticket.status}
                disabled={changingStatus}
                onChange={(event) => changeStatus(event.target.value)}
                aria-label="Ticket status"
              >
                {TICKET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {humanize(status)}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-ink-muted">
                The employee is notified whenever this changes.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</p>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  )
}

/**
 * One reply.
 *
 * The org's messages are tinted and the employee's are plain, so the thread can
 * be read at a glance without matching names to avatars. It is the SAME
 * treatment in both portals — "us on the right" would mean the two sides
 * remember the conversation differently.
 */
function Message({
  message, viewer, timezone, orgName,
}: {
  message: ThreadMessage
  viewer: 'employee' | 'org'
  timezone: string
  orgName: string
}) {
  const fromOrg = message.authorRole === 'org'
  const displayName = fromOrg ? message.authorName || orgName : message.authorName

  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        fromOrg ? 'border-brand-200 bg-brand-50/50' : 'border-line bg-card'
      )}
    >
      <div className="flex items-center gap-2.5">
        <Avatar className="size-8">
          {message.authorPhoto ? (
            <AvatarImage
              src={`/api/files/view?key=${encodeURIComponent(message.authorPhoto)}`}
              alt=""
            />
          ) : null}
          <AvatarFallback className="text-[10px]">
            {message.authorName ? initials(message.authorName, null) : fromOrg ? 'HR' : '?'}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {displayName}
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-ink-muted">
              {fromOrg ? (
                <>
                  <Building2 className="size-3" aria-hidden />
                  {viewer === 'org' ? 'Your organization' : orgName}
                </>
              ) : (
                <>
                  <UserRound className="size-3" aria-hidden />
                  Employee
                </>
              )}
            </span>
          </p>
        </div>

        <span className="shrink-0 text-xs text-ink-muted">
          {formatLocal(message.createdAt, timezone, 'd MMM, HH:mm')}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{message.body}</p>

      {message.attachmentKey ? (
        <div className="mt-3">
          <AttachmentLink keyName={message.attachmentKey} name={message.attachmentName} />
        </div>
      ) : null}
    </div>
  )
}

function AttachmentLink({ keyName, name }: { keyName: string; name: string | null }) {
  return (
    <a
      href={`/api/files/view?key=${encodeURIComponent(keyName)}&download=${encodeURIComponent(
        name || 'attachment'
      )}`}
      className="inline-flex items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-[13px] font-medium transition hover:bg-page"
    >
      <Paperclip className="size-3.5 text-ink-muted" aria-hidden />
      <span className="max-w-[240px] truncate">{name || 'Attachment'}</span>
      <FileText className="size-3.5 text-ink-muted" aria-hidden />
    </a>
  )
}
