'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { COMMON_TIMEZONES } from '@/lib/timezones'
import { contrastOn } from '@/lib/utils'

const PRESET_COLORS = ['#C41E33', '#2563EB', '#16A34A', '#7C3AED', '#EA580C', '#0F766E']

export function OnboardingFlow({
  orgName, defaultColor, defaultTimezone,
}: {
  orgName: string
  defaultColor: string
  defaultTimezone: string
}) {
  const router = useRouter()
  const [primaryColor, setPrimaryColor] = React.useState(defaultColor)
  const [timezone, setTimezone] = React.useState(defaultTimezone)
  const [departmentName, setDepartmentName] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      await apiPost('/api/org/settings', { primaryColor, timezone, departmentName })
      router.replace('/org')
      router.refresh()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="w-full max-w-lg">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <h1 className="text-[26px] font-bold tracking-[-0.025em]">Welcome to {orgName}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Three quick choices and your workspace is ready. All of them can be changed later.
        </p>
      </div>

      <div className="card-surface p-7">
        <form onSubmit={onSubmit} className="space-y-6">
          <FormError message={error} />

          <FormField label="Your brand colour" error={fields.primaryColor}>
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Use ${color}`}
                    aria-pressed={primaryColor.toLowerCase() === color.toLowerCase()}
                    onClick={() => setPrimaryColor(color)}
                    className={`focus-ring size-9 rounded-lg transition ${
                      primaryColor.toLowerCase() === color.toLowerCase()
                        ? 'ring-2 ring-ink ring-offset-2'
                        : 'ring-1 ring-line'
                    }`}
                    style={{ background: color }}
                  />
                ))}
              </div>
              <div
                className="rounded-lg px-4 py-2.5 text-center text-sm font-medium"
                style={{ background: primaryColor, color: contrastOn(primaryColor) }}
              >
                This is how your workspace will look
              </div>
            </div>
          </FormField>

          <FormField
            label="Timezone"
            error={fields.timezone}
            hint="Attendance days, late-login checks and visa reminders all use this."
            required
          >
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
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
            label="Your first department"
            error={fields.departmentName}
            hint="For example Engineering, Operations or Administration."
            required
          >
            <Input
              value={departmentName}
              onChange={(e) => setDepartmentName(e.target.value)}
              placeholder="Engineering"
              required
            />
          </FormField>

          <Button type="submit" className="w-full" size="lg" loading={submitting}>
            Finish setup
            <ArrowRight />
          </Button>
        </form>
      </div>
    </div>
  )
}
