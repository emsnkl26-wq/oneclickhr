'use client'

import * as React from 'react'
import { Upload, Download, Trash2, Pencil, FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/patterns'
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card'
import { uploadFile, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { formatSize } from '@/lib/messaging-shared'
import { formatLocal } from '@/lib/time'

export interface OrgFileRow {
  id: string
  fileUrl: string
  fileName: string | null
  label: string | null
  mimeType: string | null
  sizeBytes: number | null
  createdAt: string
}

/**
 * The organization's shared file store (013).
 *
 * A place for the whole workspace to keep its documents — policies, templates,
 * anything. These are org-level files (no employee attached), stored through the
 * same validated upload pipeline as everything else and filed as `general`
 * documents so they are also searchable on the Documents screen.
 */
export function OrgFilesTab({
  initialFiles,
  timezone,
}: {
  initialFiles: OrgFileRow[]
  timezone: string
}) {
  const [files, setFiles] = React.useState<OrgFileRow[]>(initialFiles)
  const [uploading, setUploading] = React.useState(false)
  const [renaming, setRenaming] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!chosen.length) return
    setUploading(true)
    try {
      for (const file of chosen) {
        const result = await uploadFile(file, 'general')
        if (result.documentId) {
          setFiles((prev) => [
            {
              id: result.documentId!,
              fileUrl: result.key,
              fileName: file.name,
              label: null,
              mimeType: result.contentType,
              sizeBytes: file.size,
              createdAt: new Date().toISOString(),
            },
            ...prev,
          ])
        }
      }
      toast.success(chosen.length === 1 ? 'File uploaded' : `${chosen.length} files uploaded`)
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'The upload did not complete. Please try again.'
      )
    } finally {
      setUploading(false)
    }
  }

  async function saveRename(id: string) {
    const label = renameValue.trim()
    try {
      await apiPatch(`/api/org/documents/${id}`, { label: label || null })
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, label: label || null } : f)))
      setRenaming(null)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not rename the file.')
    }
  }

  async function remove(row: OrgFileRow) {
    if (!window.confirm(`Delete “${row.label || row.fileName}”? This cannot be undone.`)) return
    try {
      await apiDelete(`/api/org/documents/${row.id}`)
      setFiles((prev) => prev.filter((f) => f.id !== row.id))
      toast.success('File deleted')
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not delete the file.')
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            Your organization’s shared files. Upload and store anything your team needs in one place.
          </CardDescription>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onPick}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
            {uploading ? 'Uploading…' : 'Upload files'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No files yet"
            description="Upload your organization’s documents to keep them all in one place."
          />
        ) : (
          <ul className="divide-y divide-line">
            {files.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-3">
                <FileText className="size-5 shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  {renaming === row.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={renameValue}
                        autoFocus
                        maxLength={120}
                        placeholder={row.fileName ?? 'Name this file'}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename(row.id)
                          if (e.key === 'Escape') setRenaming(null)
                        }}
                      />
                      <Button size="sm" onClick={() => saveRename(row.id)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="truncate text-sm font-medium text-ink">
                        {row.label || row.fileName || 'Untitled'}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {[
                          row.sizeBytes ? formatSize(Number(row.sizeBytes)) : null,
                          formatLocal(row.createdAt, timezone, 'd MMM yyyy'),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </>
                  )}
                </div>
                {renaming === row.id ? null : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button asChild size="icon" variant="ghost" aria-label={`Download ${row.fileName}`}>
                      <a href={`/api/files/view?key=${encodeURIComponent(row.fileUrl)}`} download>
                        <Download />
                      </a>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Rename"
                      onClick={() => {
                        setRenameValue(row.label ?? '')
                        setRenaming(row.id)
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete"
                      onClick={() => remove(row)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
