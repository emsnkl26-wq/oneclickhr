'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPatch, ApiClientError } from '@/lib/fetcher'

/**
 * The workspace's overtime rule (049).
 *
 * Its own card, posting only its own field — the settings route treats an
 * absent key as "leave it alone", so this can never revert an edit made in the
 * Workspace form above it, or the other way round.
 */
export function OvertimeForm({ threshold }: { threshold: number | null }) {
  const router = useRouter()
  const [enabled, setEnabled] = React.useState(threshold !== null)
  const [hours, setHours] = React.useState(String(threshold ?? 40))
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const value = Number(hours)
  const invalid = enabled && (hours.trim() === '' || !Number.isFinite(value) || value < 1 || value > 168)
  const unchanged = enabled ? threshold === value : threshold === null

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (invalid) return
    setError(null)
    setBusy(true)
    try {
      await apiPatch('/api/org/settings', {
        overtimeWeeklyThreshold: enabled ? Math.round(value * 100) / 100 : null,
      })
      toast.success(enabled ? 'Overtime rule saved' : 'Overtime switched off')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overtime</CardTitle>
        <CardDescription>
          Billable hours on a weekly timesheet above this limit are overtime. A manager approves
          them when reviewing the week, and they are paid and billed at each placement&apos;s
          overtime rate (usually 1.5×).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <FormError message={error} />
          <label className="flex items-center justify-between gap-4 rounded-lg border border-line p-3">
            <span className="text-sm font-medium">Track overtime on timesheets</span>
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Track overtime" />
          </label>
          {enabled ? (
            <FormField
              label="Regular hours per week"
              hint="40 is the US standard. Hours above it count as overtime."
              error={invalid ? 'Enter between 1 and 168 hours' : undefined}
            >
              <Input
                type="number"
                inputMode="decimal"
                min={1}
                max={168}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                aria-invalid={invalid}
                className="max-w-[10rem]"
              />
            </FormField>
          ) : null}
          <Button type="submit" loading={busy} disabled={invalid || unchanged}>
            Save overtime rule
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
