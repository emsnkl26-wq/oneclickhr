'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Search, MoreHorizontal, Users, UserCheck, UserMinus } from 'lucide-react'
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
import { apiDelete, apiPost, ApiClientError } from '@/lib/fetcher'
import { formatLocal } from '@/lib/time'
import { initials } from '@/lib/utils'
import { DeleteEmployeeDialog } from '@/components/profile/delete-employee-dialog'
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
  employeeLimit,
  onboardingIds = [],
}: {
  employees: EmployeeRow[] | null
  employeeCount: number
  departments: { id: string; name: string }[]
  drafts: DraftRow[] | null
  draftCount: number
  tab: 'team' | 'drafts'
  timezone: string
  /** How many employee accounts this workspace may hold (061). */
  employeeLimit: number
  /**
   * Accounts whose onboarding is still open. They can sign in — that is the
   * point — but they are not a finished member of the team yet, so they get
   * their own status rather than being counted among the active.
   */
  onboardingIds?: string[]
}) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [department, setDepartment] = React.useState('all')
  const [status, setStatus] = React.useState('active')
  const [pending, setPending] = React.useState<EmployeeRow | null>(null)
  /** The separate, irreversible one. Kept in its own state so the two dialogs
      can never be confused for one another by a stray `open` prop. */
  const [deleting, setDeleting] = React.useState<EmployeeRow | null>(null)
  const [busy, setBusy] = React.useState(false)

  const deptName = React.useMemo(
    () => new Map(departments.map((d) => [d.id, d.name])),
    [departments]
  )

  const onboarding = React.useMemo(() => new Set(onboardingIds), [onboardingIds])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (employees ?? []).filter((e) => {
      // "Active" means finished AND switched on. Someone mid-onboarding is
      // neither deactivated nor done, so they answer to their own filter.
      if (status === 'active' && (!e.is_active || onboarding.has(e.id))) return false
      if (status === 'inactive' && e.is_active) return false
      if (status === 'onboarding' && !onboarding.has(e.id)) return false
      if (department !== 'all' && e.department_id !== department) return false
      if (!q) return true
      return [e.full_name, e.email, e.employee_code, e.designation, e.phone]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    })
  }, [employees, query, department, status, onboarding])

  async function toggleActive(employee: EmployeeRow) {
    setBusy(true)
    try {
      if (employee.is_active) {
        await apiDelete(`/api/org/employees/${employee.id}`)
        toast.success(`${employee.full_name || 'Employee'} has left the organization`)
      } else {
        // One column, no payload. This used to re-send the whole employee record
        // with `isActive: true`, because PATCH writes every field it validates —
        // so flipping one boolean meant writing back whatever copy of the person
        // this table happened to be holding.
        await apiPost(`/api/org/employees/${employee.id}`)
        toast.success(`${employee.full_name || 'Employee'} is back on the team`)
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
              className="block truncate font-medium hover:text-brand-ink hover:underline"
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
      cell: (row) =>
        // "Inactive" described the column; "Left" describes the person, and
        // matches the filter and the action that got them here.
        !row.is_active ? (
          <StatusChip status="inactive" label="Left" />
        ) : onboarding.has(row.id) ? (
          <StatusChip status="onboarding" label="Onboarding" tone="warning" />
        ) : (
          <StatusChip status="active" />
        ),
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
            {/*
              Two different acts, and the wording is what keeps them apart.

              "Remove from the organization" is the ordinary one — the person
              has left, they lose access on their next request, and every record
              about them stays. "Delete permanently" is the rare one and says so
              in the only verb that cannot be misread.
            */}
            <DropdownMenuItem destructive={row.is_active} onSelect={() => setPending(row)}>
              {row.is_active ? 'Remove from organization' : 'Bring back to the team'}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onSelect={() => setDeleting(row)}>
              Delete permanently
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  const activeCount = (employees ?? []).filter(
    (e) => e.is_active && !onboarding.has(e.id)
  ).length
  const onboardingCount = (employees ?? []).filter((e) => onboarding.has(e.id)).length

  /*
   * "Team (n)" counts the people who are still with the organization.
   *
   * It used to count every employee ROW, which meant removing somebody left the
   * tab reading the same number it did before — the org had done the thing and
   * the product said nothing had changed. Somebody who has left is not on the
   * team, so they are not in the count; they are still one filter away under
   * "Deactivated", and every record about them is untouched.
   *
   * Derived from the rows when this tab is open, because they are already here
   * and a derived number can never disagree with the table under it. The server
   * count is the fallback for the tab that was not fetched.
   */
  const teamCount = employees ? employees.filter((e) => e.is_active).length : employeeCount
  /** People who have left. The only list they appear in, so it has to be findable. */
  const departedCount = (employees ?? []).filter((e) => !e.is_active).length
  const seatsLeft = Math.max(0, employeeLimit - teamCount)

  return (
    <div className="space-y-4">
      <LinkTabs
        active={tab}
        tabs={[
          { value: 'team', label: `Team (${teamCount})` },
          {
            value: 'drafts',
            // Not "Drafts" any more: the tab also holds onboardings that have an
            // account and are with the employee, or waiting on a review.
            label: 'Onboarding',
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
              <option value="onboarding">Onboarding ({onboardingCount})</option>
              <option value="inactive">Left the organization ({departedCount})</option>
              <option value="all">All</option>
            </Select>
          </div>

          {/*
            The seat limit (061), stated before it is hit rather than at the
            moment somebody is blocked. Only shown once it is close: an org with
            four people does not need a budget line on this screen.
          */}
          {seatsLeft <= 5 ? (
            <p
              className={`rounded-lg border px-3.5 py-2.5 text-[13px] ${
                seatsLeft === 0
                  ? 'border-danger/30 bg-danger/5 text-ink'
                  : 'border-line bg-page text-ink-muted'
              }`}
            >
              {seatsLeft === 0 ? (
                <>
                  <strong className="font-semibold">
                    You are using all {employeeLimit} of your employee accounts.
                  </strong>{' '}
                  Remove someone who has left to free a place, or contact support and we will raise
                  the limit for your organization.
                </>
              ) : (
                <>
                  {teamCount} of {employeeLimit} employee accounts used — {seatsLeft}{' '}
                  {seatsLeft === 1 ? 'place' : 'places'} left. Need more? Contact support and we
                  will raise it for you.
                </>
              )}
            </p>
          ) : null}

          {/*
            Nobody vanishes without being told where they went.

            "Active" deliberately excludes people who are still onboarding, which
            means an admin who has just added someone would otherwise look at
            this table and not find them. One line, and a way straight to them.
          */}
          {status === 'active' && onboardingCount > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50/60 px-3.5 py-2.5 text-[13px] text-amber-900">
              <span>
                {onboardingCount === 1
                  ? '1 more person is still being onboarded and is not shown here.'
                  : `${onboardingCount} more people are still being onboarded and are not shown here.`}
              </span>
              <button
                type="button"
                onClick={() => setStatus('onboarding')}
                className="focus-ring rounded font-semibold underline underline-offset-2"
              >
                Show them
              </button>
            </p>
          ) : null}

          {/*
            THE WAY BACK.

            Removing somebody is reversible, and the only screen that can
            reverse it is the one they have just vanished from — so the page has
            to say where they went. Without this line the filter was the only
            route back, and a filter you have no reason to open is not a route.
          */}
          {status === 'active' && departedCount > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-page px-3.5 py-2.5 text-[13px] text-ink-muted">
              <span>
                {departedCount === 1
                  ? '1 person has left the organization. Their records are kept, and you can bring them back.'
                  : `${departedCount} people have left the organization. Their records are kept, and you can bring them back.`}
              </span>
              <button
                type="button"
                onClick={() => setStatus('inactive')}
                className="focus-ring rounded font-semibold text-ink underline underline-offset-2"
              >
                Show them
              </button>
            </p>
          ) : null}

          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(row) => row.id}
            empty={
              employees.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No employees yet"
                  description="Adding someone takes three fields — they get an account and sign-in details straight away, and the onboarding details can follow."
                  action={
                    <Button asChild>
                      <Link href="/org/employees/onboard">Add your first employee</Link>
                    </Button>
                  }
                />
              ) : status === 'active' && !query.trim() && department === 'all' && activeCount === 0 && departedCount > 0 ? (
                /*
                  Nobody active, but somebody HAS been here. "No matches / try a
                  different search term" was the wrong answer to that — there is
                  no search term, and the thing the admin is looking for is one
                  click away. Only shown when no search or department filter is
                  narrowing the list, or it would be explaining the wrong absence.
                */
                <EmptyState
                  icon={UserMinus}
                  title="Nobody is on the team right now"
                  description={
                    departedCount === 1
                      ? 'One person has left the organization. Everything about them was kept — bring them back, or add somebody new.'
                      : `${departedCount} people have left the organization. Everything about them was kept — bring them back, or add somebody new.`
                  }
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button variant="secondary" onClick={() => setStatus('inactive')}>
                        Show who has left
                      </Button>
                      <Button asChild>
                        <Link href="/org/employees/onboard">Add employee</Link>
                      </Button>
                    </div>
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
                <UserMinus className="size-5 text-danger" />
              ) : (
                <UserCheck className="size-5 text-emerald-600" />
              )}
              {pending?.is_active
                ? `Remove ${pending?.full_name || 'this employee'} from the organization?`
                : `Bring ${pending?.full_name || 'this employee'} back?`}
            </DialogTitle>
            <DialogDescription>
              {pending?.is_active
                ? 'They leave the organization: their sign-in stops working on their very next request, and they disappear from the team, from every list they could be picked from, and from the employee count. Nothing about them is deleted — attendance, leave, timesheets and payroll stay exactly as they are, so if they ever rejoin you can bring them back with their whole history intact.'
                : 'They rejoin the team and can sign in again with their existing password. Everything recorded against them before they left is still there, and they take one of your employee seats again.'}
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
              {pending?.is_active ? 'Remove from organization' : 'Bring them back'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/*
        The irreversible one, behind the typed-name confirmation it has always
        had on the employee's own page. Same component, same endpoint — this is
        a second way IN, not a second, laxer rule.
      */}
      <DeleteEmployeeDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        name={deleting?.full_name ?? null}
        endpoint={`/api/org/employees/${deleting?.id}?permanent=true`}
        onDeleted={() => {
          setDeleting(null)
          router.refresh()
        }}
      />
    </div>
  )
}
