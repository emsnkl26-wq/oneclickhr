'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Download, FileText, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { EmptyState } from '@/components/ui/patterns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiDelete, apiPatch, uploadFile, ApiClientError } from '@/lib/fetcher'

export interface EmployeeDocument {
  id: string
  file_url: string
  file_name: string | null
  label: string | null
  kind: string
  created_at: string
}

const KIND_LABELS: Record<string, string> = {
  employee_doc: 'Employee document',
  work_auth: 'Work authorization',
  general: 'General',
}

/**
 * The employee's documents, and the employer adding to them (056).
 *
 * Uploads go through the ordinary two-phase pipeline with this employee's id,
 * so the file lands in `documents` against them — visible here, in the org's
 * Documents library, and to the employee themselves.
 */
export function EmployeeDocuments({
  employeeId, employeeName, documents,
}: {
  employeeId: string
  employeeName: string
  documents: EmployeeDocument[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState<string | null>(null)

  async function remove(doc: EmployeeDocument) {
    if (!window.confirm(`Delete "${doc.label || doc.file_name || 'this document'}"? This cannot be undone.`)) return
    setDeleting(doc.id)
    try {
      await apiDelete(`/api/org/documents/${doc.id}`)
      toast.success('Document deleted')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not delete the document.')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Documents</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Upload />
          Add documents
        </Button>
      </CardHeader>
      {documents.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No documents"
          description="Upload contracts, IDs or anything else you keep for this person."
        />
      ) : (
        <ul className="divide-y divide-line">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-5 py-2.5">
              <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
              {/* The label says what the file IS; the file name is whatever the
                  scanner called it, so it drops to a subtitle under a label. */}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{doc.label || doc.file_name || 'Untitled'}</span>
                <span className="block truncate text-xs text-ink-muted">
                  {[doc.label ? doc.file_name : null, KIND_LABELS[doc.kind] ?? null].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Button asChild size="icon" variant="ghost" aria-label="Download">
                <a
                  href={`/api/files/view?key=${encodeURIComponent(doc.file_url)}&download=${encodeURIComponent(
                    doc.file_name || 'document'
                  )}`}
                >
                  <Download />
                </a>
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Delete"
                loading={deleting === doc.id}
                onClick={() => remove(doc)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <UploadDialog
        open={open}
        employeeId={employeeId}
        employeeName={employeeName}
        onClose={() => setOpen(false)}
        onDone={() => {
          setOpen(false)
          router.refresh()
        }}
      />
    </Card>
  )
}

function UploadDialog({
  open, employeeId, employeeName, onClose, onDone,
}: {
  open: boolean
  employeeId: string
  employeeName: string
  onClose: () => void
  onDone: () => void
}) {
  const [files, setFiles] = React.useState<File[]>([])
  const [label, setLabel] = React.useState('')
  const [kind, setKind] = React.useState<'employee_doc' | 'work_auth' | 'general'>('employee_doc')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)

  React.useEffect(() => {
    if (!open) return
    setFiles([])
    setLabel('')
    setKind('employee_doc')
    setError(null)
    setBusy(false)
    setProgress(0)
  }, [open])

  async function submit() {
    if (!files.length) {
      setError('Choose at least one file.')
      return
    }
    setError(null)
    setBusy(true)
    let done = 0
    try {
      for (const file of files) {
        const uploaded = await uploadFile(file, kind, { employeeId })
        // One label for a single file; with several, each keeps its own name.
        if (label.trim() && files.length === 1 && uploaded.documentId) {
          await apiPatch(`/api/org/documents/${uploaded.documentId}`, { label: label.trim() })
        }
        done += 1
        setProgress(done)
      }
      toast.success(done === 1 ? 'Document added' : `${done} documents added`)
      onDone()
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : 'The upload did not complete.'
      setError(done ? `${done} of ${files.length} uploaded. ${message}` : message)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Add documents</DialogTitle>
          <DialogDescription>For {employeeName}. PDFs, images and Office files, up to 25 MB each.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <FormField label="Files" required>
            <Input
              type="file"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
          </FormField>
          <FormField label="Type">
            <Select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
              {Object.entries(KIND_LABELS).map(([value, text]) => (
                <option key={value} value={value}>{text}</option>
              ))}
            </Select>
          </FormField>
          {files.length <= 1 ? (
            <FormField label="Label" hint="Optional — what the document is, e.g. Signed offer letter.">
              <Input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
            </FormField>
          ) : null}
          {busy && files.length > 1 ? (
            <p className="tabular text-sm text-ink-muted">
              Uploading {Math.min(progress + 1, files.length)} of {files.length}…
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={submit}>
            <Upload />
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
