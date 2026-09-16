'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Bell, ImagePlus, Loader2, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { Switch } from '@/components/ui/primitives'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { apiPost, uploadFile, ApiClientError } from '@/lib/fetcher'
import { notificationImageProblem, notificationImageSrc } from '@/lib/notification-image'
import { formatLocal } from '@/lib/time'
import type { NotificationTarget } from '@/types/db'

interface SentRow {
  id: string
  title: string
  description: string | null
  send_to_type: NotificationTarget
  target_id: string | null
  image_url: string | null
  created_at: string
}

export function NotificationComposer({
  sent, departments, employees, timezone,
}: {
  sent: SentRow[]
  departments: { id: string; name: string }[]
  employees: { id: string; full_name: string | null; email: string | null }[]
  timezone: string
}) {
  const router = useRouter()
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [sendToType, setSendToType] = React.useState<NotificationTarget>('all')
  const [targetId, setTargetId] = React.useState('')
  const [alsoEmail, setAlsoEmail] = React.useState(false)
  /**
   * One value, two ways in: a pasted https:// link, or the storage key an
   * upload returns. The composer keeps them in the SAME state because the
   * column does too — whichever arrived last is the image.
   */
  const [imageUrl, setImageUrl] = React.useState('')
  const [uploading, setUploading] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  const nameFor = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const d of departments) map.set(d.id, d.name)
    for (const e of employees) map.set(e.id, e.full_name || e.email || 'Employee')
    return map
  }, [departments, employees])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      const result = await apiPost<{ emailed: number }>('/api/org/notifications', {
        title,
        description: description || undefined,
        sendToType,
        targetId: sendToType === 'all' ? null : targetId,
        imageUrl: imageUrl.trim() || undefined,
        alsoEmail,
      })
      toast.success(
        result.emailed ? `Sent, and emailed to ${result.emailed} people` : 'Notification sent'
      )
      setTitle('')
      setDescription('')
      setImageUrl('')
      router.refresh()
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

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clear the input straight away so choosing the SAME file twice still fires
    // a change event — otherwise a failed upload cannot be retried.
    event.target.value = ''
    if (!file) return

    setUploading(true)
    try {
      const { key } = await uploadFile(file, 'notification_image')
      setImageUrl(key)
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not upload that image')
    } finally {
      setUploading(false)
    }
  }

  // Shown as you type. The server's schema is still the real check.
  const imageProblem = notificationImageProblem(imageUrl)
  const preview = imageProblem ? null : notificationImageSrc(imageUrl)

  function audienceLabel(row: SentRow): string {
    if (row.send_to_type === 'all') return 'Everyone'
    const name = row.target_id ? nameFor.get(row.target_id) : null
    return name ?? (row.send_to_type === 'department' ? 'A department' : 'One person')
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[400px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Compose</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormError message={error} />

            <FormField label="Title" error={fields.title} required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Timesheet deadline moved"
                required
              />
            </FormField>

            <FormField label="Message" error={fields.description}>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Add any detail your team needs."
              />
            </FormField>

            {/*
              Two ways in, one value. A pasted link is the quicker path when the
              picture is already hosted somewhere; the upload is for the far more
              common case of a file sitting on somebody's desktop.
            */}
            <FormField
              label="Image"
              error={fields.imageUrl ?? imageProblem ?? undefined}
              hint="Optional. Paste an https:// link, or upload a picture. Only a pasted link can show inside the email copy."
            >
              <div className="space-y-2">
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://example.com/banner.png"
                  aria-invalid={!!imageProblem}
                  // An uploaded key is not a link anyone can usefully edit by
                  // hand, so it is shown in the preview below rather than here.
                  className={imageUrl && !imageUrl.startsWith('http') ? 'sr-only' : undefined}
                />

                <div className="flex items-center gap-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={onPickFile}
                    className="sr-only"
                    aria-label="Upload an image"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
                    {uploading ? 'Uploading…' : imageUrl ? 'Replace image' : 'Upload an image'}
                  </Button>
                  {imageUrl ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setImageUrl('')}
                    >
                      <X />
                      Remove
                    </Button>
                  ) : null}
                </div>

                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview}
                    alt="Announcement image preview"
                    className="max-h-44 w-full rounded-lg border border-line object-cover"
                  />
                ) : null}
              </div>
            </FormField>

            <FormField label="Send to">
              <Select
                value={sendToType}
                onChange={(e) => {
                  setSendToType(e.target.value as NotificationTarget)
                  setTargetId('')
                }}
              >
                <option value="all">Everyone</option>
                <option value="department">A department</option>
                <option value="employee">One employee</option>
              </Select>
            </FormField>

            {sendToType === 'department' ? (
              <FormField label="Department" error={fields.targetId} required>
                <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                  <option value="">Choose a department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            {sendToType === 'employee' ? (
              <FormField label="Employee" error={fields.targetId} required>
                <Select value={targetId} onChange={(e) => setTargetId(e.target.value)} required>
                  <option value="">Choose an employee</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.full_name || e.email}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            <div className="flex items-start gap-3 rounded-lg bg-page p-3.5">
              <Switch id="also-email" checked={alsoEmail} onCheckedChange={setAlsoEmail} />
              <label htmlFor="also-email" className="cursor-pointer">
                <span className="block text-sm font-medium">Also send by email</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  In-app delivery happens either way.
                </span>
              </label>
            </div>

            <Button
              type="submit"
              className="w-full"
              loading={submitting}
              disabled={uploading || !!imageProblem}
            >
              <Send />
              Send notification
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently sent</CardTitle>
        </CardHeader>
        {sent.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing sent yet"
            description="Your announcements will be listed here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {sent.map((row) => (
              <li key={row.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    {row.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={notificationImageSrc(row.image_url) as string}
                        alt=""
                        className="size-11 shrink-0 rounded-lg border border-line object-cover"
                      />
                    ) : null}
                    <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    {row.description ? (
                      <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-muted">
                        {row.description}
                      </p>
                    ) : null}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {formatLocal(row.created_at, timezone, 'd MMM, HH:mm')}
                  </span>
                </div>
                <div className="mt-2">
                  <StatusChip
                    status={row.send_to_type === 'all' ? 'info' : 'neutral'}
                    tone={row.send_to_type === 'all' ? 'info' : 'neutral'}
                    label={audienceLabel(row)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
