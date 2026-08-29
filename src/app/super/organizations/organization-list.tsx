'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BadgeCheck, Building2, MoreHorizontal, Search } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { FormField } from '@/components/ui/form-field'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import type { TenantStatus } from '@/types/db'

interface TenantRow {
  id: string
  name: string
  slug: string
  status: TenantStatus
  primary_color: string
  timezone: string
  created_at: string
  onboarded_at: string | null
  domain: string | null
  domain_verified_at: string | null
  employeeCount: number
  orgCount: number
  inactiveCount: number
}

export function OrganizationList({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [status, setStatus] = React.useState('all')
  const [pending, setPending] = React.useState<TenantRow | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return tenants.filter((tenant) => {
      if (status !== 'all' && tenant.status !== status) return false
      if (!q) return true
      return (
        tenant.name.toLowerCase().includes(q) ||
        tenant.slug.toLowerCase().includes(q) ||
        // Searchable because "are these two workspaces the same company?" is the
        // question this page exists to answer, and the domain answers it.
        (tenant.domain ?? '').includes(q)
      )
    })
  }, [tenants, query, status])

  async function toggleStatus() {
    if (!pending) return
    const next = pending.status === 'active' ? 'suspended' : 'active'
    setBusy(true)
    try {
      await apiPatch(`/api/super/tenants/${pending.id}`, { status: next, reason: reason || undefined })
      toast.success(next === 'suspended' ? `${pending.name} suspended` : `${pending.name} reactivated`)
      setPending(null)
      setReason('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<TenantRow>[] = [
    {
      key: 'org',
      header: 'Organization',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg text-xs font-bold text-white"
            style={{ background: row.primary_color }}
            aria-hidden
          >
            {row.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <Link
              href={`/super/organizations/${row.id}`}
              className="block truncate font-medium hover:text-brand-600 hover:underline"
            >
              {row.name}
            </Link>
            <span className="block truncate text-xs text-ink-muted">/{row.slug}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'people',
      header: 'People',
      cell: (row) => (
        <span className="tabular">
          {row.employeeCount}
          <span className="text-ink-muted"> employees</span>
        </span>
      ),
    },
    {
      key: 'domain',
      header: 'Website',
      cell: (row) =>
        row.domain ? (
          <span className="flex items-center gap-1.5">
            <span className="truncate text-ink">{row.domain}</span>
            {row.domain_verified_at ? (
              <BadgeCheck className="size-3.5 shrink-0 text-emerald-600" aria-label="Verified" />
            ) : (
              <span className="shrink-0 text-[11px] text-amber-600">unverified</span>
            )}
          </span>
        ) : (
          <span className="text-ink-muted">—</span>
        ),
    },
    {
      key: 'timezone',
      header: 'Timezone',
      cell: (row) => <span className="text-ink-muted">{row.timezone}</span>,
    },
    {
      key: 'created',
      header: 'Signed up',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, 'UTC', 'd MMM yyyy')}
        </span>
      ),
    },
    {
      key: 'onboarded',
      header: 'Onboarded',
      cell: (row) =>
        row.onboarded_at ? (
          <StatusChip status="active" label="Yes" />
        ) : (
          <StatusChip status="pending" label="Not finished" />
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.status} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-10',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/super/organizations/${row.id}`}>Open details</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive={row.status === 'active'}
              onSelect={() => setPending(row)}
            >
              {row.status === 'active' ? 'Suspend' : 'Reactivate'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or slug"
            className="pl-9"
            aria-label="Search organizations"
          />
        </div>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="sm:w-44"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Building2}
            title={tenants.length ? 'No matches' : 'No organizations yet'}
            description={
              tenants.length
                ? 'Try a different search term.'
                : 'Workspaces appear here as soon as someone signs up.'
            }
          />
        }
      />

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {pending?.status === 'active' ? 'Suspend' : 'Reactivate'} {pending?.name}
            </DialogTitle>
            <DialogDescription>
              {pending?.status === 'active'
                ? `All ${pending.employeeCount + pending.orgCount} accounts in this workspace lose access immediately — on their very next request. No data is deleted.`
                : 'Everyone in this workspace regains access straight away.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-4">
            <FormField label="Reason" hint="Recorded in the audit log. Optional.">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={pending?.status === 'active' ? 'danger' : 'default'}
              loading={busy}
              onClick={toggleStatus}
            >
              {pending?.status === 'active' ? 'Suspend workspace' : 'Reactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
