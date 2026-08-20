'use client'

import * as React from 'react'
import { useProgressRouter } from '@/lib/use-progress-router'
import { Download, FileUp, Loader2, Search, Trash2, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import { apiPost, apiDelete, uploadFile, ApiClientError } from '@/lib/fetcher'
import { MONTH_NAMES } from '@/lib/time'
import { initials } from '@/lib/utils'

interface EmployeeRow {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
  employee_code: string | null
  designation: string | null
}

interface PayslipRow {
  id: string
  employee_id: string
  month: number
  year: number
  file_url: string
  file_name: string | null
  created_at: string
}

export function PayrollManager({
  employees, payslips, month, year,
}: {
  employees: EmployeeRow[]
  payslips: PayslipRow[]
  month: number
  year: number
}) {
  const router = useProgressRouter()
  const [query, setQuery] = React.useState('')
  const [uploadingFor, setUploadingFor] = React.useState<string | null>(null)

  const byEmployee = React.useMemo(
    () => new Map(payslips.map((p) => [p.employee_id, p])),
    [payslips]
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return employees
    return employees.filter((e) =>
      [e.full_name, e.email, e.employee_code].filter(Boolean).some((f) => f!.toLowerCase().includes(q))
    )
  }, [employees, query])

  const years = React.useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: 6 }, (_, i) => current - i)
  }, [])

  function setPeriod(nextMonth: number, nextYear: number) {
    router.push(`/org/payroll?month=${nextMonth}&year=${nextYear}`)
  }

  async function onUpload(employeeId: string, file: File) {
    setUploadingFor(employeeId)
    try {
      // The pipeline verifies the bytes really are a PDF before this returns.
      const uploaded = await uploadFile(file, 'payslip')
      await apiPost('/api/org/payslips', {
        employeeId,
        month,
        year,
        key: uploaded.key,
        fileName: file.name,
      })
      toast.success('Payslip uploaded')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'That upload failed')
    } finally {
      setUploadingFor(null)
    }
  }

  async function onDelete(payslipId: string) {
    try {
      await apiDelete(`/api/org/payslips/${payslipId}`)
      toast.success('Payslip removed')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    }
  }

  const columns: Column<EmployeeRow>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8">
            {row.photo_url ? (
              <AvatarImage src={`/api/files/view?key=${encodeURIComponent(row.photo_url)}`} alt="" />
            ) : null}
            <AvatarFallback>{initials(row.full_name, row.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.full_name || row.email}</p>
            <p className="truncate text-xs text-ink-muted">{row.designation || '—'}</p>
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
      key: 'status',
      header: 'Payslip',
      cell: (row) => {
        const payslip = byEmployee.get(row.id)
        return payslip ? (
          <StatusChip status="active" label="Uploaded" />
        ) : (
          <StatusChip status="pending" label="Not uploaded" />
        )
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-[230px]',
      cell: (row) => {
        const payslip = byEmployee.get(row.id)
        const busy = uploadingFor === row.id

        return (
          <div className="flex justify-end gap-1.5">
            {payslip ? (
              <>
                <Button asChild size="sm" variant="secondary">
                  <a
                    href={`/api/files/view?key=${encodeURIComponent(payslip.file_url)}&download=${encodeURIComponent(
                      payslip.file_name || 'payslip.pdf'
                    )}`}
                  >
                    <Download />
                    Download
                  </a>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove payslip for ${row.full_name}`}
                  onClick={() => onDelete(payslip.id)}
                >
                  <Trash2 />
                </Button>
              </>
            ) : (
              <label
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-[13px] font-medium shadow-sm transition hover:bg-page ${
                  busy ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileUp className="size-4" />
                )}
                {busy ? 'Uploading…' : 'Upload PDF'}
                <input
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) onUpload(row.id, file)
                  }}
                />
              </label>
            )}
          </div>
        )
      },
    },
  ]

  const uploaded = payslips.length

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={String(month)}
          onChange={(e) => setPeriod(Number(e.target.value), year)}
          aria-label="Month"
          className="sm:w-40"
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </Select>
        <Select
          value={String(year)}
          onChange={(e) => setPeriod(month, Number(e.target.value))}
          aria-label="Year"
          className="sm:w-32"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>

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

        <span className="tabular shrink-0 rounded-lg bg-page px-3 py-2 text-[13px] text-ink-muted">
          {uploaded} of {employees.length} uploaded
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Wallet}
            title={employees.length ? 'No matches' : 'No employees yet'}
            description={
              employees.length
                ? 'Try a different search term.'
                : 'Add your team before uploading payslips.'
            }
          />
        }
      />
    </div>
  )
}
