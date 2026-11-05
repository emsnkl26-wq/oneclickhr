'use client'

/**
 * Two-step verification (064), per administrator.
 *
 * OFF → "Set up" opens a dialog that mints a secret, shows the QR to scan (and
 * the key to type if a camera won't do), and switches 2FA on once a code from
 * the app checks out. ON → the card shows it is on, lets the workspace choose
 * how often a code is asked for, and turns it off only when a current code is
 * entered — disabling a security control should itself need the control.
 *
 * Enrolment is this admin's own: the secret belongs to the signed-in person,
 * and the window is the one org-wide setting.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, ApiClientError } from '@/lib/fetcher'

const WINDOW_OPTIONS = [
  { value: '4', label: 'Every 4 hours' },
  { value: '8', label: 'Every 8 hours' },
  { value: '12', label: 'Every 12 hours' },
  { value: '24', label: 'Once a day' },
]

export function TwoFactorCard({ enabled, windowHours }: { enabled: boolean; windowHours: number }) {
  const router = useRouter()
  const [setupOpen, setSetupOpen] = React.useState(false)
  const [disableOpen, setDisableOpen] = React.useState(false)
  const [savingWindow, setSavingWindow] = React.useState(false)
  // Show the saved window from the preset list; fall back to 8 for odd values.
  const initialWindow = WINDOW_OPTIONS.some((o) => o.value === String(windowHours))
    ? String(windowHours)
    : '8'
  const [windowValue, setWindowValue] = React.useState(initialWindow)

  async function onChangeWindow(value: string) {
    const previous = windowValue
    setWindowValue(value)
    setSavingWindow(true)
    try {
      await apiPatch('/api/org/settings', { twoFactorWindowHours: Number(value) })
      toast.success('Re-prompt frequency updated')
    } catch (err) {
      setWindowValue(previous)
      toast.error(err instanceof ApiClientError ? err.message : 'Could not save that')
    } finally {
      setSavingWindow(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-step verification
          {enabled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
              <ShieldCheck className="size-3" aria-hidden />
              On
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              Off
            </span>
          )}
        </CardTitle>
        <CardDescription>
          {enabled
            ? 'Your account asks for a code from your authenticator app on this schedule.'
            : 'Protect your admin account with a code from an authenticator app (Google Authenticator, 1Password, Authy…).'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {enabled ? (
          <>
            <FormField label="Ask for a code" hint="Applies to every administrator in this workspace.">
              <Select
                value={windowValue}
                onChange={(e) => onChangeWindow(e.target.value)}
                disabled={savingWindow}
                options={WINDOW_OPTIONS}
              />
            </FormField>
            <Button variant="secondary" onClick={() => setDisableOpen(true)}>
              <ShieldOff />
              Turn off
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setSetupOpen(true)}>
            <ShieldCheck />
            Set up
          </Button>
        )}
      </CardContent>

      <SetupDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        onEnabled={() => {
          setSetupOpen(false)
          router.refresh()
        }}
      />

      <DisableDialog
        open={disableOpen}
        onClose={() => setDisableOpen(false)}
        onDisabled={() => {
          setDisableOpen(false)
          router.refresh()
        }}
      />
    </Card>
  )
}

interface SetupData {
  secret: string
  otpauthUrl: string
  qr: string
}

function SetupDialog({
  open, onClose, onEnabled,
}: {
  open: boolean
  onClose: () => void
  onEnabled: () => void
}) {
  const [data, setData] = React.useState<SetupData | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  // Start the enrolment the moment the dialog opens, so the QR is ready.
  React.useEffect(() => {
    if (!open) {
      setData(null)
      setCode('')
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    apiPost<SetupData>('/api/org/security/2fa/setup')
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiClientError ? err.message : 'Could not start setup.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/org/security/2fa/enable', { code })
      toast.success('Two-step verification is on')
      onEnabled()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Set up two-step verification</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-2">
            <FormError message={error} />

            {loading ? (
              <div className="aspect-square w-full max-w-[240px] mx-auto animate-pulse rounded-lg bg-muted" />
            ) : data ? (
              <>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
                  <li>Open your authenticator app and scan this QR code.</li>
                  <li>Enter the 6-digit code it shows, below.</li>
                </ol>
                <div className="flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={data.qr}
                    alt="Authenticator QR code"
                    className="rounded-lg border border-line bg-white p-2"
                    width={200}
                    height={200}
                  />
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-ink-muted">Can’t scan it?</summary>
                  <p className="mt-2 text-ink-muted">Enter this key in your app instead:</p>
                  <code className="mt-1 block break-all rounded-md bg-muted px-2 py-1.5 text-[13px] tabular">
                    {data.secret}
                  </code>
                </details>
                <FormField label="Code from your app" required>
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    className="tabular text-center text-lg tracking-[0.4em]"
                    aria-label="6-digit code"
                    required
                  />
                </FormField>
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!data || code.length !== 6}>
              Turn on
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DisableDialog({
  open, onClose, onDisabled,
}: {
  open: boolean
  onClose: () => void
  onDisabled: () => void
}) {
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) {
      setCode('')
      setError(null)
    }
  }, [open])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/org/security/2fa/disable', { code })
      toast.success('Two-step verification is off')
      onDisabled()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Turn off two-step verification</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-2">
            <FormError message={error} />
            <p className="text-sm text-ink-muted">
              Enter a current code from your authenticator app to confirm.
            </p>
            <FormField label="Code from your app" required>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="123456"
                className="tabular text-center text-lg tracking-[0.4em]"
                aria-label="6-digit code"
                required
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" loading={submitting} disabled={code.length !== 6}>
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
