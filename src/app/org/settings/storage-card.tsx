'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { HardDrive } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { StatusChip } from '@/components/ui/patterns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

export interface StorageRequestRow {
  id: string
  requested_bytes: number
  reason: string
  status: 'pending' | 'approved' | 'declined'
  granted_bytes: number | null
  admin_note: string | null
  created_at: string
}

/** "512 MB", "1.5 GB" — the client twin of `formatBytes` in lib/storage-quota. */
function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/**
 * How much of the workspace's storage is used, and the way to ask for more
 * (056). Requests are reviewed by hand by the OneclickHR team; nothing is
 * charged.
 */
export function StorageCard({
  used, limit, requests,
}: {
  used: number
  limit: number
  requests: StorageRequestRow[]
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [gigabytes, setGigabytes] = React.useState('1')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const ratio = limit > 0 ? Math.min(1, used / limit) : 1
  const pending = requests.find((r) => r.status === 'pending')

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      await apiPost('/api/org/storage-requests', { gigabytes, reason })
      toast.success('Request sent. We will let you know once it is reviewed.')
      setOpen(false)
      setReason('')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDrive className="size-4 text-ink-muted" aria-hidden />
          Storage
        </CardTitle>
        <CardDescription>Documents, payslips, photos and receipts all count toward this.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="tabular mb-1.5 flex items-baseline justify-between text-sm">
            <span className="font-medium text-ink">{bytes(used)} used</span>
            <span className="text-ink-muted">of {bytes(limit)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-page ring-1 ring-inset ring-line">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                ratio >= 0.95 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-brand-500'
              )}
              style={{ width: `${Math.max(ratio * 100, used ? 1 : 0)}%` }}
            />
          </div>
          {ratio >= 0.8 ? (
            <p className="mt-1.5 text-xs text-ink-muted">
              {ratio >= 1 ? 'Storage is full — new uploads are refused.' : 'You are running low on space.'}
            </p>
          ) : null}
        </div>

        {pending ? (
          <p className="rounded-lg bg-page px-3.5 py-2.5 text-sm text-ink-muted">
            Request for {bytes(pending.requested_bytes)} more is waiting for review.
          </p>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Request more storage
          </Button>
        )}

        {requests.filter((r) => r.status !== 'pending').slice(0, 3).map((r) => (
          <div key={r.id} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0 text-ink-muted">
              {new Date(r.created_at).toLocaleDateString()} · asked for {bytes(r.requested_bytes)}
              {r.granted_bytes ? `, granted ${bytes(r.granted_bytes)}` : ''}
              {r.admin_note ? <span className="block truncate text-xs">“{r.admin_note}”</span> : null}
            </span>
            <StatusChip status={r.status === 'approved' ? 'approved' : 'rejected'} label={r.status === 'approved' ? 'Approved' : 'Declined'} />
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Request more storage</DialogTitle>
            <DialogDescription>
              Tell us how much and why. The OneclickHR team reviews requests by hand — there is no charge.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />
            <FormField label="Additional space (GB)" required>
              <Input type="number" min={1} max={1000} step={1} value={gigabytes} onChange={(e) => setGigabytes(e.target.value)} />
            </FormField>
            <FormField label="Reason" required>
              <Textarea
                rows={4}
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="We keep scanned contracts and ID documents for 120 employees…"
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button loading={busy} onClick={submit}>
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
