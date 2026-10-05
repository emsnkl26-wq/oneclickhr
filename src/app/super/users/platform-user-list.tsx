'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Users, ShieldAlert, Trash2, MailWarning } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Textarea, Checkbox } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { FilterSelect } from '@/components/ui/filter-select'
import { Pagination } from '@/components/ui/pagination'
import { FormField } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, apiPost, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import type { UserRole } from '@/types/db'
import { DeleteUserDialog, type DeletableUser } from '../delete-user-dialog'

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Platform',
  org: 'Owner',
  employee: 'Employee',
  candidate: 'Job seeker',
}

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
  /** The nearest-expiring work authorization on record (056). */
  visaType: string | null
  visaExpiry: string | null
  /** What they told onboarding, for anyone without a visa row. */
  workAuthStatus: string | null
}

/** Whole days from today to an ISO date; negative once it has passed. */
function daysUntil(iso: string): number {
  const today = new Date(new Date().toISOString().slice(0, 10)).getTime()
  return Math.round((new Date(iso).getTime() - today) / 86_400_000)
}

function VisaCell({ row }: { row: UserRow }) {
  if (row.role !== 'employee') return <span className="text-ink-muted">—</span>
  if (!row.visaExpiry) {
    return <span className="text-ink-muted">{row.workAuthStatus || 'Not recorded'}</span>
  }
  const days = daysUntil(row.visaExpiry)
  const tone =
    days < 0 ? 'bg-red-50 text-red-700 ring-red-200'
      : days <= 30 ? 'bg-amber-50 text-amber-700 ring-amber-200'
        : days <= 90 ? 'bg-yellow-50 text-yellow-800 ring-yellow-200'
          : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
  return (
    <div className="min-w-0">
      <p className="truncate text-[13px] font-medium">{row.visaType}</p>
      <span className={`tabular inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${tone}`}>
        {days < 0 ? `Expired ${formatLocal(row.visaExpiry, 'UTC', 'd MMM yyyy')}` : `Expires ${formatLocal(row.visaExpiry, 'UTC', 'd MMM yyyy')}`}
        {days >= 0 ? ` · ${days}d` : ''}
      </span>
    </div>
  )
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
  const [deleting, setDeleting] = React.useState<DeletableUser | null>(null)
  const [reminding, setReminding] = React.useState<UserRow | null>(null)

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
      key: 'visa',
      header: 'Work authorization',
      cell: (row) => <VisaCell row={row} />,
    },
    {
      key: 'role',
      header: 'Role',
      cell: (row) => (
        <StatusChip
          status={row.role === 'super_admin' ? 'brand' : row.role === 'org' ? 'info' : 'neutral'}
          tone={row.role === 'super_admin' ? 'brand' : row.role === 'org' ? 'info' : 'neutral'}
          label={ROLE_LABELS[row.role]}
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
      className: 'w-52',
      cell: (row) =>
        row.role === 'super_admin' ? (
          <span className="block text-right text-xs text-ink-muted">Managed in Supabase</span>
        ) : (
          <div className="flex justify-end gap-1">
            {row.role === 'employee' && row.visaExpiry && row.email ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Email ${row.full_name || row.email} a visa reminder`}
                title="Send a visa expiry reminder"
                onClick={() => setReminding(row)}
              >
                <MailWarning />
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={() => setPending(row)}>
              {row.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
            {(row.role === 'employee' || row.role === 'candidate') && row.email ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${row.full_name || row.email} permanently`}
                className="text-red-600 hover:text-red-700"
                onClick={() =>
                  setDeleting({
                    id: row.id,
                    name: row.full_name,
                    email: row.email!,
                    role: row.role as 'employee' | 'candidate',
                    organization: row.tenant_id ? row.tenantName : null,
                  })
                }
              >
                <Trash2 />
              </Button>
            ) : null}
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
            { value: 'candidate', label: 'Job seekers' },
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
        <FilterSelect
          param="visa"
          label="Filter by work authorization"
          className="sm:w-48"
          options={[
            { value: '', label: 'Any visa status' },
            { value: 'expiring', label: 'Expiring in 90 days' },
            { value: 'expired', label: 'Expired' },
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

      <DeleteUserDialog user={deleting} onClose={() => setDeleting(null)} />

      <RemindDialog user={reminding} onClose={() => setReminding(null)} />

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

/** Send one visa reminder by email (056). */
function RemindDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const [note, setNote] = React.useState('')
  const [copyEmployer, setCopyEmployer] = React.useState(true)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!user) return
    setNote('')
    setCopyEmployer(true)
    setBusy(false)
  }, [user])

  async function send() {
    if (!user) return
    setBusy(true)
    try {
      await apiPost(`/api/super/users/${user.id}/visa-reminder`, { note, copyEmployer })
      toast.success(`Reminder sent to ${user.email}`)
      onClose()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not send the reminder.')
      setBusy(false)
    }
  }

  const days = user?.visaExpiry ? daysUntil(user.visaExpiry) : null

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailWarning className="size-5 text-brand-600" />
            Send a visa reminder
          </DialogTitle>
          <DialogDescription>
            {user?.full_name || user?.email} ({user?.tenantName}) — {user?.visaType}{' '}
            {days === null ? '' : days < 0 ? `expired ${-days} days ago` : `expires in ${days} days`}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4 pb-4">
          <FormField label="Message" hint="Optional — added to the email.">
            <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox checked={copyEmployer} onChange={(e) => setCopyEmployer(e.target.checked)} />
            Copy the employer&apos;s administrators
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={send}>
            Send reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
