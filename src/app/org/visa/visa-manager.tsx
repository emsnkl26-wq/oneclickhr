'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { BadgeCheck, FileUp, Loader2, Pencil, Plus, Trash2, Download } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea, DateField } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Avatar, AvatarFallback, AvatarImage,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, apiDelete, uploadFile, ApiClientError } from '@/lib/fetcher'
import { daysUntil } from '@/lib/time'
import { initials } from '@/lib/utils'

interface VisaRecord {
  id: string
  employee_id: string
  visa_type: string
  visa_number: string | null
  start_date: string | null
  expiry_date: string
  document_url: string | null
  notes: string | null
  sentMilestones: number[]
}

interface EmployeeOption {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
}

const MILESTONES = [90, 30, 7, 0]

export function VisaManager({
  records, employees, timezone,
}: {
  records: VisaRecord[]
  employees: EmployeeOption[]
  timezone: string
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<VisaRecord | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<VisaRecord | null>(null)
  const [busy, setBusy] = React.useState(false)

  const employeeById = React.useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  async function onDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await apiDelete(`/api/org/visa/${deleting.id}`)
      toast.success('Record removed')
      setDeleting(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<VisaRecord>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => {
        const person = employeeById.get(row.employee_id)
        return (
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8">
              {person?.photo_url ? (
                <AvatarImage
                  src={`/api/files/view?key=${encodeURIComponent(person.photo_url)}`}
                  alt=""
                />
              ) : null}
              <AvatarFallback>{initials(person?.full_name, person?.email)}</AvatarFallback>
            </Avatar>
            <span className="truncate font-medium">
              {person?.full_name || person?.email || 'Former employee'}
            </span>
          </div>
        )
      },
    },
    {
      key: 'type',
      header: 'Type',
      cell: (row) => (
        <div>
          <p className="font-medium">{row.visa_type}</p>
          <p className="tabular text-xs text-ink-muted">{row.visa_number || '—'}</p>
        </div>
      ),
    },
    {
      key: 'expiry',
      header: 'Expires',
      cell: (row) => <span className="tabular whitespace-nowrap">{row.expiry_date}</span>,
    },
    {
      key: 'remaining',
      header: 'Remaining',
      cell: (row) => {
        const days = daysUntil(row.expiry_date, timezone)
        if (days < 0) return <StatusChip status="rejected" label="Expired" />
        return (
          <StatusChip
            status={days <= 7 ? 'urgent' : days <= 30 ? 'high' : days <= 90 ? 'medium' : 'low'}
            label={days === 0 ? 'Today' : `${days} days`}
          />
        )
      },
    },
    {
      key: 'reminders',
      header: 'Reminders sent',
      cell: (row) => (
        <div className="flex gap-1">
          {MILESTONES.map((milestone) => {
            const sent = row.sentMilestones.includes(milestone)
            return (
              <span
                key={milestone}
                title={
                  sent
                    ? `${milestone}-day reminder already sent — it will never send again`
                    : `${milestone}-day reminder not yet due`
                }
                className={`tabular grid h-6 min-w-[30px] place-items-center rounded-md px-1 text-[11px] font-medium ring-1 ring-inset ${
                  sent
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : 'bg-page text-ink-muted/70 ring-line'
                }`}
              >
                {milestone}
              </span>
            )
          })}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-[120px]',
      cell: (row) => (
        <div className="flex justify-end gap-0.5">
          {row.document_url ? (
            <Button asChild size="icon" variant="ghost" aria-label="Download document">
              <a href={`/api/files/view?key=${encodeURIComponent(row.document_url)}&download=visa-document`}>
                <Download />
              </a>
            </Button>
          ) : null}
          <Button size="icon" variant="ghost" aria-label="Edit" onClick={() => setEditing(row)}>
            <Pencil />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => setDeleting(row)}>
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)} disabled={!employees.length}>
          <Plus />
          Add record
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={records}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={BadgeCheck}
            title="No work authorizations recorded"
            description="Add an H-1B record and we will email you at 90, 30, 7 and 0 days before it expires — once each, never twice."
            action={
              employees.length ? (
                <Button onClick={() => setCreating(true)}>Add the first record</Button>
              ) : undefined
            }
          />
        }
      />

      <VisaDialog
        open={creating || !!editing}
        record={editing}
        employees={employees}
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
            <DialogTitle>Remove this record?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              The reminder history goes with it. If the visa was renewed, edit the expiry date
              instead — that resets the reminders for the new date.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={onDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function VisaDialog({
  open, record, employees, onClose, onSaved,
}: {
  open: boolean
  record: VisaRecord | null
  employees: EmployeeOption[]
  onClose: () => void
  onSaved: () => void
}) {
  const [employeeId, setEmployeeId] = React.useState('')
  const [visaType, setVisaType] = React.useState('H-1B')
  const [visaNumber, setVisaNumber] = React.useState('')
  const [startDate, setStartDate] = React.useState('')
  const [expiryDate, setExpiryDate] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [documentKey, setDocumentKey] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setFields({})
    if (record) {
      setEmployeeId(record.employee_id)
      setVisaType(record.visa_type)
      setVisaNumber(record.visa_number ?? '')
      setStartDate(record.start_date ?? '')
      setExpiryDate(record.expiry_date)
      setNotes(record.notes ?? '')
      setDocumentKey(record.document_url)
    } else {
      setEmployeeId(employees[0]?.id ?? '')
      setVisaType('H-1B')
      setVisaNumber('')
      setStartDate('')
      setExpiryDate('')
      setNotes('')
      setDocumentKey(null)
    }
  }, [open, record, employees])

  const expiryChanged = !!record && record.expiry_date !== expiryDate

  async function onUpload(file: File) {
    setUploading(true)
    try {
      const uploaded = await uploadFile(file, 'work_auth')
      setDocumentKey(uploaded.key)
      toast.success('Document uploaded')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'That upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const payload = {
      employeeId,
      visaType,
      visaNumber: visaNumber || undefined,
      startDate: startDate || null,
      expiryDate,
      documentKey: documentKey || undefined,
      notes: notes || undefined,
    }

    try {
      if (record) {
        await apiPatch(`/api/org/visa/${record.id}`, payload)
        toast.success(
          expiryChanged ? 'Updated — reminders reset for the new expiry date' : 'Record updated'
        )
      } else {
        await apiPost('/api/org/visa', payload)
        toast.success('Record added')
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
            <DialogTitle>{record ? 'Edit work authorization' : 'Add work authorization'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="Employee" error={fields.employeeId} required>
              <Select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={!!record}
                required
              >
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name || e.email}
                  </option>
                ))}
              </Select>
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Visa type" required>
                <Input value={visaType} onChange={(e) => setVisaType(e.target.value)} required />
              </FormField>
              <FormField label="Visa number">
                <Input value={visaNumber} onChange={(e) => setVisaNumber(e.target.value)} />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Start date">
                <DateField
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </FormField>
              <FormField label="Expiry date" error={fields.expiryDate} required>
                <DateField
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  required
                />
              </FormField>
            </div>

            {expiryChanged ? (
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-blue-800">
                Changing the expiry date clears the reminder history for this record, so the
                90/30/7/0 reminders will fire again for the new date.
              </p>
            ) : null}

            <FormField label="Document" hint="The approval notice or petition. Stored privately.">
              <div className="flex items-center gap-2">
                <label
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-page ${
                    uploading ? 'pointer-events-none opacity-60' : ''
                  }`}
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <FileUp className="size-4" />
                  )}
                  {documentKey ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    className="sr-only"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) onUpload(file)
                    }}
                  />
                </label>
                {documentKey ? (
                  <span className="text-[13px] text-emerald-700">Attached</span>
                ) : (
                  <span className="text-[13px] text-ink-muted">None</span>
                )}
              </div>
            </FormField>

            <FormField label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={uploading}>
              {record ? 'Save changes' : 'Add record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
