'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LifeBuoy, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { Pagination } from '@/components/ui/pagination'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { AttachmentDrop, type Attachment } from '@/components/timesheet/attachment-drop'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { useProgressRouter } from '@/lib/use-progress-router'
import { formatLocal } from '@/lib/time'
import { TICKET_PRIORITIES } from '@/lib/schemas'
import { humanize } from '@/lib/utils'
import type { TicketPriority, TicketStatus } from '@/types/db'

export interface TicketRow {
  id: string
  code: string
  subject: string
  priority: TicketPriority
  status: TicketStatus
  created_at: string
  last_activity_at: string
}

export function TicketList({
  tickets, total, page, perPage, timezone,
}: {
  tickets: TicketRow[]
  total: number
  page: number
  perPage: number
  timezone: string
}) {
  const [creating, setCreating] = React.useState(false)

  const columns: Column<TicketRow>[] = [
    {
      key: 'code',
      header: 'Ticket ID',
      className: 'w-28',
      cell: (row) => (
        <Link
          href={`/employee/helpdesk/${row.id}`}
          className="tabular font-medium text-brand-600 hover:underline"
        >
          {row.code}
        </Link>
      ),
    },
    {
      key: 'subject',
      header: 'Subject',
      cell: (row) => (
        <Link href={`/employee/helpdesk/${row.id}`} className="block truncate font-medium hover:underline">
          {row.subject}
        </Link>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      cell: (row) => <StatusChip status={row.priority} label={humanize(row.priority)} />,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      key: 'created',
      header: 'Created',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, timezone, 'd MMM yyyy')}
        </span>
      ),
    },
    {
      key: 'updated',
      header: 'Last updated',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.last_activity_at, timezone, 'd MMM, HH:mm')}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New ticket
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={tickets}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={LifeBuoy}
            title="No tickets yet"
            description="Raise a ticket for IT support, an HR question or an access request, and your organization will pick it up."
            action={<Button onClick={() => setCreating(true)}>Raise a ticket</Button>}
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <NewTicketDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}

function NewTicketDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const progressRouter = useProgressRouter()
  const [subject, setSubject] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [priority, setPriority] = React.useState<TicketPriority>('medium')
  const [attachment, setAttachment] = React.useState<Attachment | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setSubject('')
    setDescription('')
    setPriority('medium')
    setAttachment(null)
    setError(null)
    setFields({})
  }, [open])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      const created = await apiPost<{ id: string }>('/api/tickets', {
        subject,
        description,
        priority,
        attachmentKey: attachment?.key,
        attachmentName: attachment?.name,
      })
      toast.success('Ticket raised')
      onClose()
      router.refresh()
      progressRouter.push(`/employee/helpdesk/${created.id}`)
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
            <DialogTitle>New ticket</DialogTitle>
            <DialogDescription>
              Describe what you need. You will be notified when someone replies.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Subject" error={fields.subject} required>
              <Input
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Laptop will not connect to the VPN"
                required
              />
            </FormField>

            <FormField label="Priority" error={fields.priority}>
              <Select
                value={priority}
                onChange={(event) => setPriority(event.target.value as TicketPriority)}
              >
                {TICKET_PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {humanize(value)}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField label="Description" error={fields.description} required>
              <Textarea
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What is happening, what you have already tried, and how urgent it is."
                required
              />
            </FormField>

            <AttachmentDrop
              value={attachment}
              onChange={setAttachment}
              label="Attachment"
              hint="Optional — a screenshot or a document helps (PDF, images, Office files)."
            />
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Raise ticket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
