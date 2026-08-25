'use client'

import * as React from 'react'
import { UploadCloud, FileText, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { uploadFile, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

export interface Attachment {
  key: string
  name: string
}

/**
 * The "upload your client's timesheet export" zone.
 *
 * Some end clients keep their own time system and want the export attached to
 * the week it belongs to, so this accepts whatever they produce — a PDF, a
 * spreadsheet, a photo of a signed sheet.
 *
 * It uploads through the ordinary two-phase pipeline (`uploadFile`), which means
 * the bytes go straight to storage and are sniffed at finalize. Nothing here
 * decides what is safe; it only reports what the pipeline said.
 *
 * The drag counter is a counter rather than a boolean on purpose: `dragleave`
 * fires when the pointer crosses onto a CHILD element, so a boolean makes the
 * highlight flicker as the pointer moves over the icon and the text inside.
 */
export function AttachmentDrop({
  value,
  onChange,
  disabled,
  employeeId,
  label = 'Upload timesheet file',
  hint = 'Drag and drop or click to upload (PDF, Excel, images accepted)',
}: {
  value: Attachment | null
  onChange: (attachment: Attachment | null) => void
  disabled?: boolean
  /** Set when someone else must be able to read the file — see the org reply flow. */
  employeeId?: string
  label?: string
  hint?: string
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragDepth, setDragDepth] = React.useState(0)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function accept(file: File | undefined) {
    if (!file || disabled) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await uploadFile(file, 'general', employeeId ? { employeeId } : {})
      onChange({ key: uploaded.key, name: file.name })
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'That upload failed.')
    } finally {
      setUploading(false)
      setDragDepth(0)
    }
  }

  if (value) {
    return (
      <div className="space-y-2">
        <p className="text-[13px] font-medium text-ink">{label}</p>
        <div className="flex items-center gap-3 rounded-lg border border-line bg-card px-3.5 py-3">
          <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
          <a
            href={`/api/files/view?key=${encodeURIComponent(value.key)}&download=${encodeURIComponent(value.name)}`}
            className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
          >
            {value.name}
          </a>
          {disabled ? null : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Remove this attachment"
              onClick={() => onChange(null)}
            >
              <X />
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[13px] font-medium text-ink">{label}</p>

      <div
        onDragEnter={(event) => {
          event.preventDefault()
          if (!disabled) setDragDepth((depth) => depth + 1)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
        onDrop={(event) => {
          event.preventDefault()
          setDragDepth(0)
          void accept(event.dataTransfer.files?.[0])
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        className={cn(
          'focus-ring flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition',
          disabled
            ? 'cursor-not-allowed border-line bg-page/60'
            : 'cursor-pointer border-line bg-page/40 hover:border-brand-500 hover:bg-brand-50/40',
          dragDepth > 0 && 'border-brand-600 bg-brand-50/60'
        )}
      >
        {uploading ? (
          <Loader2 className="size-5 animate-spin text-ink-muted" aria-hidden />
        ) : (
          <UploadCloud className="size-6 text-ink-muted" aria-hidden />
        )}
        <p className="mt-2 text-sm font-medium text-ink">
          {uploading ? 'Uploading…' : 'No attachments uploaded'}
        </p>
        <p className="mt-1 max-w-sm text-xs text-ink-muted">{hint}</p>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          disabled={disabled || uploading}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void accept(file)
          }}
        />
      </div>

      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  )
}
