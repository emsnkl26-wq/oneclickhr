'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Users, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { FilterSelect } from '@/components/ui/filter-select'
import { Pagination } from '@/components/ui/pagination'
import { FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import type { UserRole } from '@/types/db'

interface UserRow {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole
  tenant_id: string | null
  tenantName: string
  is_active: boolean
  must_change_password: boolean
  created_at: string
}

/**
 * `users` is one page, already filtered by the server. The controls write to
 * the URL — see the page component for why the whole table no longer travels to
 * the browser to be filtered here.
 */
export function PlatformUserList({
  users, total, page, perPage, filtered,
}: {
  users: UserRow[]
  total: number
  page: number
  perPage: number
  /** True when a search or filter is narrowing the list. */
  filtered: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = React.useState<UserRow | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  async function toggleActive() {
    if (!pending) return
    setBusy(true)
    try {
      await apiPatch(`/api/super/users/${pending.id}`, {
        isActive: !pending.is_active,
        reason: reason || undefined,
      })
      toast.success(pending.is_active ? 'Account deactivated' : 'Account reactivated')
      setPending(null)
      setReason('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: 'user',
      header: 'User',
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.full_name || 'Unnamed'}</p>
          <p className="truncate text-xs text-ink-muted">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'org',
      header: 'Organization',
      cell: (row) => <span className="truncate text-ink-muted">{row.tenantName}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) => (
        <StatusChip
          status={row.role === 'super_admin' ? 'brand' : row.role === 'org' ? 'info' : 'neutral'}
          tone={row.role === 'super_admin' ? 'brand' : row.role === 'org' ? 'info' : 'neutral'}
          label={row.role === 'super_admin' ? 'Platform' : row.role === 'org' ? 'Owner' : 'Employee'}
        />
      ),
    },
    {
      key: 'created',
      header: 'Created',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, 'UTC', 'd MMM yyyy')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <div className="flex flex-wrap gap-1.5">
          <StatusChip status={row.is_active ? 'active' : 'inactive'} />
          {row.must_change_password ? (
            <StatusChip status="pending" label="Password not set" />
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-32',
      cell: (row) =>
        row.role === 'super_admin' ? (
          <span className="block text-right text-xs text-ink-muted">Managed in Supabase</span>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setPending(row)}>
              {row.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </div>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField param="q" placeholder="Search by name or email" label="Search users" />
        <FilterSelect
          param="role"
          label="Filter by role"
          className="sm:w-40"
          options={[
            { value: '', label: 'All roles' },
            { value: 'org', label: 'Owners' },
            { value: 'employee', label: 'Employees' },
            { value: 'super_admin', label: 'Platform' },
          ]}
        />
        <FilterSelect
          param="status"
          label="Filter by status"
          className="sm:w-40"
          options={[
            { value: '', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Deactivated' },
          ]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={users}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Users}
            title={filtered ? 'No matches' : 'No users yet'}
            description={
              filtered
                ? 'Try a different search or clear the filters.'
                : 'Accounts appear here as they are created.'
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="size-5 text-brand-600" />
              {pending?.is_active ? 'Deactivate' : 'Reactivate'} this account
            </DialogTitle>
            <DialogDescription>
              {pending?.full_name || pending?.email} at {pending?.tenantName}.{' '}
              {pending?.is_active
                ? 'They lose access immediately — on their next request, not when their session expires.'
                : 'They will be able to sign in again with their existing password.'}
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
              variant={pending?.is_active ? 'danger' : 'default'}
              loading={busy}
              onClick={toggleActive}
            >
              {pending?.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
