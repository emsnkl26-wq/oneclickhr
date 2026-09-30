'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useProgressRouter } from '@/lib/use-progress-router'
import { ChevronLeft, ChevronRight, Search, CalendarCheck, Check } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Avatar, AvatarFallback, AvatarImage,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { cn, initials, formatHours } from '@/lib/utils'
import { formatLocal, fromZonedInput, hoursBetween, toZonedInput } from '@/lib/time'

interface EmployeeRow {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
  employee_code: string | null
  department_id: string | null
}

interface AttendanceRecord {
  id: string
  employee_id: string
  date: string
  login_time: string
  logout_time: string | null
  total_hours: number | null
  is_late: boolean
  /** Set when the org corrected the times (055). */
  edited_at: string | null
}

/** The record being corrected, with who it belongs to for the dialog title. */
interface Editing {
  record: AttendanceRecord
  employeeName: string
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function shiftWeek(anchor: string, weeks: number): string {
  const [y, m, d] = anchor.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + weeks * 7)
  return date.toISOString().slice(0, 10)
}

export function AttendanceGrid({
  employees, departments, records, days, anchor, timezone,
}: {
  employees: EmployeeRow[]
  departments: { id: string; name: string }[]
  records: AttendanceRecord[]
  days: string[]
  anchor: string
  timezone: string
}) {
  const router = useProgressRouter()
  const [query, setQuery] = React.useState('')
  const [department, setDepartment] = React.useState('all')
  const [editing, setEditing] = React.useState<Editing | null>(null)

  // `employeeId|date` -> record, so each cell is an O(1) lookup.
  const byCell = React.useMemo(() => {
    const map = new Map<string, AttendanceRecord>()
    for (const record of records) map.set(`${record.employee_id}|${record.date}`, record)
    return map
  }, [records])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees.filter((e) => {
      if (department !== 'all' && e.department_id !== department) return false
      if (!q) return true
      return [e.full_name, e.email, e.employee_code]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(q))
    })
  }, [employees, query, department])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-1.5">
          <Button
            variant="secondary"
            size="icon"
            aria-label="Previous week"
            onClick={() => router.push(`/org/attendance?week=${shiftWeek(anchor, -1)}`)}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            aria-label="Next week"
            onClick={() => router.push(`/org/attendance?week=${shiftWeek(anchor, 1)}`)}
          >
            <ChevronRight />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push('/org/attendance')}>
            This week
          </Button>
        </div>

        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search employees"
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
      </div>

      {filtered.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={CalendarCheck}
            title={employees.length ? 'No matches' : 'No employees yet'}
            description={
              employees.length
                ? 'Try a different search or clear the filters.'
                : 'Attendance appears here once you have added your team.'
            }
          />
        </div>
      ) : (
        <div className="card-surface overflow-hidden">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-page/60">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-page/95 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted backdrop-blur"
                  >
                    Employee
                  </th>
                  {days.map((day, i) => (
                    <th
                      key={day}
                      scope="col"
                      className="px-3 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
                    >
                      <span className="block">{DAY_LABELS[i]}</span>
                      <span className="tabular block font-normal normal-case text-ink-muted/80">
                        {day.slice(8)}
                      </span>
                    </th>
                  ))}
                  <th
                    scope="col"
                    className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
                  >
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((employee) => {
                  const week = days.map((day) => byCell.get(`${employee.id}|${day}`))
                  const total = week.reduce((sum, r) => sum + Number(r?.total_hours ?? 0), 0)

                  return (
                    <tr key={employee.id} className="border-b border-line last:border-0">
                      <td className="sticky left-0 z-10 bg-card px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8">
                            {employee.photo_url ? (
                              <AvatarImage
                                src={`/api/files/view?key=${encodeURIComponent(employee.photo_url)}`}
                                alt=""
                              />
                            ) : null}
                            <AvatarFallback>
                              {initials(employee.full_name, employee.email)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium">
                              {employee.full_name || employee.email}
                            </p>
                            {employee.employee_code ? (
                              <p className="tabular truncate text-xs text-ink-muted">
                                {employee.employee_code}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      {week.map((record, i) => (
                        <td key={days[i]} className="px-2 py-3 text-center align-middle">
                          <AttendanceCell
                            record={record}
                            timezone={timezone}
                            onEdit={(target) =>
                              setEditing({
                                record: target,
                                employeeName: employee.full_name || employee.email || 'Employee',
                              })
                            }
                          />
                        </td>
                      ))}

                      <td className="tabular px-4 py-3 text-right font-semibold">
                        {total > 0 ? formatHours(total) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-ink-muted">
        {[
          { label: 'On time', className: 'bg-emerald-100 text-emerald-700' },
          { label: 'Late', className: 'bg-amber-100 text-amber-700' },
          { label: 'Still clocked in', className: 'bg-blue-100 text-blue-700' },
          { label: 'Absent', className: 'bg-page text-ink-muted' },
        ].map((item) => (
          <span key={item.label} className="flex items-center gap-1.5">
            <span className={cn('size-3 rounded', item.className)} aria-hidden />
            {item.label}
          </span>
        ))}
        <span>Click a shift to correct its times · * corrected by an admin</span>
      </div>

      <EditShiftDialog editing={editing} timezone={timezone} onClose={() => setEditing(null)} />
    </div>
  )
}

/**
 * Correct one shift's clock-in and clock-out, in the workspace's zone.
 *
 * Mostly used to close a shift someone forgot to clock out of: an open shift
 * starts with clock-out blank, and the hours shown update as the times change
 * so the admin sees what will be recorded before saving.
 */
function EditShiftDialog({
  editing, timezone, onClose,
}: {
  editing: Editing | null
  timezone: string
  onClose: () => void
}) {
  const router = useRouter()
  const [loginTime, setLoginTime] = React.useState('')
  const [logoutTime, setLogoutTime] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!editing) return
    setLoginTime(toZonedInput(editing.record.login_time, timezone))
    setLogoutTime(editing.record.logout_time ? toZonedInput(editing.record.logout_time, timezone) : '')
    setReason('')
    setError(null)
    setBusy(false)
  }, [editing, timezone])

  const login = fromZonedInput(loginTime, timezone)
  const logout = fromZonedInput(logoutTime, timezone)
  const preview = login && logout ? hoursBetween(login, logout) : null

  async function save() {
    if (!editing) return
    if (!loginTime) {
      setError('Enter the clock-in time.')
      return
    }
    if (reason.trim().length < 3) {
      setError('Say briefly why the times changed.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await apiPatch(`/api/org/attendance/${editing.record.id}`, {
        loginTime,
        logoutTime: logoutTime || null,
        reason: reason.trim(),
      })
      toast.success('Shift updated')
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!editing} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Correct shift</DialogTitle>
          <DialogDescription>
            {editing ? `${editing.employeeName} · ${editing.record.date} · times in ${timezone}` : ''}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <FormError message={error} />
          <FormField label="Clock-in" required>
            <Input
              type="datetime-local"
              value={loginTime}
              onChange={(event) => setLoginTime(event.target.value)}
            />
          </FormField>
          <FormField
            label="Clock-out"
            hint={editing && !editing.record.logout_time ? 'Still clocked in — set when they actually left.' : undefined}
          >
            <Input
              type="datetime-local"
              value={logoutTime}
              min={loginTime || undefined}
              onChange={(event) => setLogoutTime(event.target.value)}
            />
          </FormField>
          <FormField label="Reason" required>
            <Input
              value={reason}
              maxLength={500}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Forgot to clock out"
            />
          </FormField>
          {preview !== null ? (
            <p className="tabular rounded-lg bg-page px-3.5 py-2.5 text-sm">
              Hours recorded: <span className="font-semibold">{formatHours(preview)}</span>
            </p>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button loading={busy} onClick={save}>
            <Check />
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AttendanceCell({
  record, timezone, onEdit,
}: {
  record?: AttendanceRecord
  timezone: string
  onEdit: (record: AttendanceRecord) => void
}) {
  if (!record) {
    return <span className="text-ink-muted/50">—</span>
  }

  const open = !record.logout_time
  const tone = open
    ? 'bg-blue-50 text-blue-700 ring-blue-200'
    : record.is_late
      ? 'bg-amber-50 text-amber-700 ring-amber-200'
      : 'bg-emerald-50 text-emerald-700 ring-emerald-200'

  return (
    <button
      type="button"
      onClick={() => onEdit(record)}
      className={cn(
        'tabular inline-flex min-w-[62px] flex-col rounded-lg px-2 py-1 text-[11px] font-medium leading-tight ring-1 ring-inset transition-shadow hover:shadow-sm focus-visible:outline-none focus-visible:ring-2',
        tone
      )}
      title={`In ${formatLocal(record.login_time, timezone, 'HH:mm')}${
        record.logout_time ? ` · Out ${formatLocal(record.logout_time, timezone, 'HH:mm')}` : ''
      }${record.edited_at ? ' · corrected by an admin' : ''} — click to correct`}
    >
      <span>{formatLocal(record.login_time, timezone, 'HH:mm')}</span>
      <span className="opacity-80">
        {open ? 'active' : formatHours(record.total_hours)}
        {record.edited_at ? '*' : ''}
      </span>
    </button>
  )
}
