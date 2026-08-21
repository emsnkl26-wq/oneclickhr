'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select, TimeField } from '@/components/ui/input'
import { ColorField } from '@/components/ui/color-field'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPatch, uploadFile, ApiClientError } from '@/lib/fetcher'
import { COMMON_TIMEZONES } from '@/lib/timezones'
import { contrastOn } from '@/lib/utils'

export function SettingsForm({
  tenant,
}: {
  tenant: {
    name: string
    primaryColor: string
    timezone: string
    workStartTime: string
    logoUrl: string | null
  }
}) {
  const router = useRouter()
  const [name, setName] = React.useState(tenant.name)
  const [primaryColor, setPrimaryColor] = React.useState(tenant.primaryColor)
  const [timezone, setTimezone] = React.useState(tenant.timezone)
  const [workStartTime, setWorkStartTime] = React.useState(tenant.workStartTime)
  const [logoKey, setLogoKey] = React.useState<string | null>(tenant.logoUrl)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  async function onLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      // Logos accept SVG — which is why the pipeline sanitizes them before
      // anything is stored.
      const uploaded = await uploadFile(file, 'logo')
      setLogoKey(uploaded.key)
      toast.success('Logo uploaded — save to apply it')
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'That upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      await apiPatch('/api/org/settings', {
        name,
        primaryColor,
        timezone,
        workStartTime,
        logoKey,
      })
      toast.success('Settings saved')
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          Your colour and logo apply across this workspace for everyone in it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <FormError message={error} />

          <FormField label="Organization name" error={fields.name} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </FormField>

          <FormField label="Logo" hint="PNG, JPEG, WebP, GIF or SVG, up to 2MB.">
            <div className="flex items-center gap-3">
              <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-page">
                {uploading ? (
                  <Loader2 className="size-4 animate-spin text-ink-muted" />
                ) : logoKey ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/files/view?key=${encodeURIComponent(logoKey)}`}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="text-lg font-bold text-ink-muted">
                    {name.charAt(0).toUpperCase()}
                  </span>
                )}
              </span>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3.5 py-2 text-sm font-medium shadow-sm transition hover:bg-page">
                <FileUp className="size-4" />
                {logoKey ? 'Replace' : 'Upload'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="sr-only"
                  disabled={uploading}
                  onChange={onLogoChange}
                />
              </label>
              {logoKey ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setLogoKey(null)}>
                  Remove
                </Button>
              ) : null}
            </div>
          </FormField>

          <FormField label="Primary colour" error={fields.primaryColor}>
            <div className="space-y-2.5">
              <ColorField
                value={primaryColor}
                onChange={setPrimaryColor}
                aria-label="Workspace primary colour"
              />
              <div
                className="rounded-lg px-3.5 py-2 text-[13px] font-medium"
                style={{ background: primaryColor, color: contrastOn(primaryColor) }}
              >
                Buttons and active navigation look like this
              </div>
            </div>
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label="Timezone"
              error={fields.timezone}
              hint="Attendance days and visa reminders are calculated here."
              required
            >
              <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {/* Keep an unlisted saved value selectable rather than silently
                    switching the org to a different zone. */}
                {!COMMON_TIMEZONES.includes(timezone) ? (
                  <option value={timezone}>{timezone}</option>
                ) : null}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Shift start"
              error={fields.workStartTime}
              hint="A clock-in after this local time is flagged late."
              required
            >
              <TimeField
                value={workStartTime}
                onChange={(e) => setWorkStartTime(e.target.value)}
                className="tabular"
                required
              />
            </FormField>
          </div>

          <Button type="submit" loading={submitting} disabled={uploading}>
            Save settings
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
