'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, MoreHorizontal, Users, UserCheck, UserX } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import {
  Avatar, AvatarFallback, AvatarImage,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/primitives'
import { LinkTabs } from '@/components/ui/link-tabs'
import { apiDelete, apiPatch, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { initials } from '@/lib/utils'
import { DraftList, type DraftRow } from './draft-list'

export interface EmployeeRow {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  photo_url: string | null
  employee_code: string | null
  designation: string | null
  department_id: string | null
  is_active: boolean
  created_at: string
}

/**
 * `employees` and `drafts` are nullable, and the null is meaningful: it says
 * "this tab is closed, so the server did not fetch it". Only the count arrives
 * for the closed tab, which is all its badge needs. See the page for why.
 */
export function EmployeeList({
  employees, employeeCount, departments, drafts, draftCount, tab, timezone,
}: {
  employees: EmployeeRow[] | null
  employeeCount: number
  departments: { id: string; name: string }[]
  drafts: DraftRow[] | null
  draftCount: number
  tab: 'team' | 'drafts'
  timezone: string
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [department, setDepartment] = React.useState('all')
  const [status, setStatus] = React.useState('active')
  const [pending, setPending] = React.useState<EmployeeRow | null>(null)
  const [busy, setBusy] = React.useState(false)

  const deptName = React.useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments]
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (employees ?? []).filter((e) => {
      if (status === 'active' && !e.is_active) return false
      if (status === 'inactive' && e.is_active) return false
      if (department !== 'all' && e.department_id !== department) return false
      if (!q) return true
      return [e.full_name, e.email, e.employee_code, e.designation, e.phone]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    })
  }, [employees, query, department, status])

  async function toggleActive(employee: EmployeeRow) {
    setBusy(true)
    try {
      if (employee.is_active) {
        await apiDelete(`/api/org/employees/${employee.id}`)
        toast.success(`${employee.full_name || 'Employee'} deactivated`)
      } else {
        await apiPatch(`/api/org/employees/${employee.id}`, {
          fullName: employee.full_name ?? '',
          phone: employee.phone ?? undefined,
          employeeCode: employee.employee_code ?? undefined,
          designation: employee.designation ?? undefined,
          departmentId: employee.department_id ?? null,
          timezone,
          isActive: true,
        })
        toast.success(`${employee.full_name || 'Employee'} reactivated`)
      }
      setPending(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<EmployeeRow>[] = [
    {
      key: 'person',
      header: 'Employee',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar>
            {row.photo_url ? (
              <AvatarImage src={`/api/files/view?key=${encodeURIComponent(row.photo_url)}`} alt="" />
            ) : null}
            <AvatarFallback>{initials(row.full_name, row.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <Link
              href={`/org/employees/${row.id}`}
              className="block truncate font-medium hover:text-brand-600 hover:underline"
            >
              {row.full_name || 'Unnamed'}
            </Link>
            <span className="block truncate text-xs text-ink-muted">{row.email}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      cell: (row) => <span className="tabular text-ink-muted">{row.employee_code || '—'}</span>,
    },
    {
      key: 'department',
      header: 'Department',
      cell: (row) => (
        <span className="text-ink-muted">
          {row.department_id ? (deptName.get(row.department_id) ?? '—') : '—'}
        </span>
      ),
    },
    {
      key: 'designation',
      header: 'Designation',
      cell: (row) => <span className="text-ink-muted">{row.designation || '—'}</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      cell: (row) => <span className="tabular text-ink-muted">{row.phone || '—'}</span>,
    },
    {
      key: 'added',
      header: 'Added',
      cell: (row) => (
        <span className="whitespace-nowrap text-ink-muted">
          {formatLocal(row.created_at, timezone, 'd MMM yyyy')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusChip status={row.is_active ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-10',
      cell: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${row.full_name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/org/employees/${row.id}`}>View &amp; edit</Link>
            </DropdownMenuItem>
            <DropdownMenuItem destructive={row.is_active} onSelect={() => setPending(row)}>
              {row.is_active ? 'Deactivate' : 'Reactivate'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const activeCount = (employees ?? []).filter((e) => e.is_active).length

  return (
    <div className="space-y-4">
      <LinkTabs
        active={tab}
        tabs={[
          { value: 'team', label: `Team (${employeeCount})` },
          {
            value: 'drafts',
            label: 'Drafts',
            badge: draftCount ? (
              <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                {draftCount}
              </span>
            ) : null,
          },
        ]}
      />

      {employees ? (
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
                placeholder="Search by name, email, code or designation"
                className="pl-9"
                aria-label="Search employees"
              />
            </div>
            <Select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              aria-label="Filter by department"
              className="sm:w-48"
            >
              <option value="all">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
              className="sm:w-40"
            >
              <option value="active">Active ({activeCount})</option>
              <option value="inactive">Deactivated</option>
              <option value="all">All</option>
            </Select>
          </div>

          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            empty={
              employees.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No employees yet"
                  description="Add your team and each person gets an account with sign-in details sent to their email."
                  action={
                    <Button asChild>
                      <Link href="/org/employees/onboard">Add your first employee</Link>
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={Search}
                  title="No matches"
                  description="Try a different search term or clear the filters."
                />
              )
            }
          />
        </div>
      ) : null}

      {drafts ? <DraftList drafts={drafts} timezone={timezone} /> : null}

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pending?.is_active ? (
                <UserX className="size-5 text-danger" />
              ) : (
                <UserCheck className="size-5 text-emerald-600" />
              )}
              {pending?.is_active ? 'Deactivate' : 'Reactivate'} {pending?.full_name}
            </DialogTitle>
            <DialogDescription>
              {pending?.is_active
                ? 'They lose access immediately — on their very next request, not when their session expires. All attendance, leave and payroll history is kept.'
                : 'They will be able to sign in again with their existing password.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={pending?.is_active ? 'danger' : 'default'}
              loading={busy}
              onClick={() => pending && toggleActive(pending)}
            >
              {pending?.is_active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
