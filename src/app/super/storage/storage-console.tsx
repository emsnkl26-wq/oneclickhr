'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { HardDrive } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

export interface RequestRow {
  id: string
  tenantId: string
  tenantName: string
  requestedBytes: number
  reason: string
  status: 'pending' | 'approved' | 'declined'
  grantedBytes: number | null
  adminNote: string | null
  createdAt: string
}

export interface TenantUsage {
  id: string
  name: string
  used: number
  limit: number
}

const GB = 1024 ** 3

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

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 1
  return (
    <div className="min-w-[160px]">
      <div className="tabular mb-1 text-xs text-ink-muted">
        {bytes(used)} / {bytes(limit)}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-page ring-1 ring-inset ring-line">
        <div
          className={cn('h-full rounded-full', ratio >= 0.95 ? 'bg-red-500' : ratio >= 0.8 ? 'bg-amber-500' : 'bg-brand-500')}
          style={{ width: `${Math.max(ratio * 100, used ? 1 : 0)}%` }}
        />
      </div>
    </div>
  )
}

export function StorageConsole({ requests, tenants }: { requests: RequestRow[]; tenants: TenantUsage[] }) {
  const [deciding, setDeciding] = React.useState<RequestRow | null>(null)
  const [limiting, setLimiting] = React.useState<TenantUsage | null>(null)
  const usageById = new Map(tenants.map((t) => [t.id, t]))

  const requestColumns: Column<RequestRow>[] = [
    {
      key: 'org',
      header: 'Organization',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.tenantName}</p>
          <p className="line-clamp-2 text-xs text-ink-muted">{row.reason}</p>
        </div>
      ),
    },
    {
      key: 'asked',
      header: 'Asked for',
      className: 'w-28',
      cell: (row) => <span className="tabular">{bytes(row.requestedBytes)}</span>,
    },
    {
      key: 'usage',
      header: 'Current usage',
      cell: (row) => {
        const usage = usageById.get(row.tenantId)
        return usage ? <UsageBar used={usage.used} limit={usage.limit} /> : <span className="text-ink-muted">—</span>
      },
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-32',
      cell: (row) => (
        <StatusChip
          status={row.status === 'declined' ? 'rejected' : row.status}
          label={row.status === 'approved' && row.grantedBytes ? `+${bytes(row.grantedBytes)}` : undefined}
        />
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-28 text-right',
      cell: (row) =>
        row.status === 'pending' ? (
          <Button size="sm" onClick={() => setDeciding(row)}>
            Review
          </Button>
        ) : null,
    },
  ]

  const tenantColumns: Column<TenantUsage>[] = [
    { key: 'name', header: 'Organization', cell: (row) => <span className="font-medium">{row.name}</span> },
    { key: 'usage', header: 'Usage', cell: (row) => <UsageBar used={row.used} limit={row.limit} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-32 text-right',
      cell: (row) => (
        <Button size="sm" variant="ghost" onClick={() => setLimiting(row)}>
          Change limit
        </Button>
      ),
    },
  ]

  const pending = requests.filter((r) => r.status === 'pending')

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Requests {pending.length ? `· ${pending.length} waiting` : ''}
        </h2>
        <DataTable
          columns={requestColumns}
          rows={requests}
          rowKey={(row) => row.id}
          empty={
            <EmptyState
              icon={HardDrive}
              title="No requests"
              description="When an organization asks for more storage from its Settings, it appears here."
            />
          }
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Organizations</h2>
        <DataTable columns={tenantColumns} rows={tenants} rowKey={(row) => row.id} />
      </section>

      <DecideDialog row={deciding} onClose={() => setDeciding(null)} />
      <LimitDialog tenant={limiting} onClose={() => setLimiting(null)} />
    </div>
  )
}

function DecideDialog({ row, onClose }: { row: RequestRow | null; onClose: () => void }) {
  const router = useRouter()
  const [gigabytes, setGigabytes] = React.useState('')
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'approved' | 'declined' | null>(null)

  React.useEffect(() => {
    if (!row) return
    setGigabytes(String(Math.max(1, Math.round(row.requestedBytes / GB))))
    setNote('')
    setError(null)
    setBusy(null)
  }, [row])

  async function decide(status: 'approved' | 'declined') {
    if (!row) return
    setError(null)
    setBusy(status)
    try {
      await apiPatch(`/api/super/storage-requests/${row.id}`, {
        status,
        gigabytes: status === 'approved' ? gigabytes : undefined,
        note,
      })
      toast.success(status === 'approved' ? `Added ${gigabytes} GB for ${row.tenantName}` : 'Request declined')
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
      setBusy(null)
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Storage request</DialogTitle>
          <DialogDescription>
            {row?.tenantName} asked for {row ? bytes(row.requestedBytes) : ''} more.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <div className="rounded-lg bg-page px-3.5 py-2.5 text-sm">
            <p className="whitespace-pre-wrap">{row?.reason}</p>
          </div>
          <FormField label="Space to add (GB)" hint="Added on top of their current limit.">
            <Input type="number" min={1} step={1} value={gigabytes} onChange={(e) => setGigabytes(e.target.value)} />
          </FormField>
          <FormField label="Note to the organization" hint="Optional — shown to them.">
            <Textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" loading={busy === 'declined'} disabled={busy === 'approved'} onClick={() => decide('declined')}>
            Decline
          </Button>
          <Button loading={busy === 'approved'} disabled={busy === 'declined'} onClick={() => decide('approved')}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LimitDialog({ tenant, onClose }: { tenant: TenantUsage | null; onClose: () => void }) {
  const router = useRouter()
  const [gigabytes, setGigabytes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!tenant) return
    setGigabytes(String(Math.round((tenant.limit / GB) * 10) / 10))
    setError(null)
    setBusy(false)
  }, [tenant])

  async function save() {
    if (!tenant) return
    setError(null)
    setBusy(true)
    try {
      await apiPatch(`/api/super/tenants/${tenant.id}/storage`, { gigabytes })
      toast.success(`${tenant.name} now has ${gigabytes} GB`)
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!tenant} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Storage limit</DialogTitle>
          <DialogDescription>
            {tenant?.name} is using {tenant ? bytes(tenant.used) : ''}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <FormField label="Limit (GB)">
            <Input type="number" min={0.1} step={0.5} value={gigabytes} onChange={(e) => setGigabytes(e.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
