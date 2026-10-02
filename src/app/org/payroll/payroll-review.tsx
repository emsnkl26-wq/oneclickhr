'use client'

/**
 * Who has confirmed being paid this month, and who has not.
 *
 * EVERY ACTIVE EMPLOYEE IS A ROW, confirmed or not. That is the whole value of
 * the screen: a list of confirmations received answers "what came in", and the
 * question payroll actually has is "who is missing" — which only a list built
 * from the PEOPLE can answer.
 *
 * The org uploads nothing here. Payroll runs in ADP and the employee uploads
 * their own confirmation (026); this screen reads and rules on them.
 */

import * as React from 'react'
import { useProgressRouter } from '@/lib/use-progress-router'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, Download, FileText, Search, Wallet, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { Checkbox } from '@/components/ui/checkbox'
import { apiGet, apiPatch, apiPost, uploadFile, ApiClientError } from '@/lib/fetcher'
import { loadOrgLogo } from '@/lib/document-pdf'
import {
  renderPayslip, payslipFileName, payslipMoney, daysInMonth, MONTHS_LONG, type SalaryBasis,
} from '@/lib/payslip-pdf'
import {
  suggestBreakdown, sumLines, type PayslipBreakdown, type PayslipLine,
} from '@/lib/payslip-breakdown'
import { MONTH_NAMES } from '@/lib/time'
import { initials, formatMoney } from '@/lib/utils'
import { periodLabel, periodsOf, type PayPeriod, type PaySchedule } from '@/lib/pay-schedule'

export interface EmployeeRow {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
  employee_code: string | null
  designation: string | null
  /** Monthly, or twice a month (050) — decides one row or two per month. */
  schedule: PaySchedule
  pay_rate: number | string | null
  pay_currency: string | null
  /** Prefill for a detailed payslip. */
  date_of_joining: string | null
  hire_date: string | null
  bank_name: string | null
}

/** A payslip already issued for the month on screen. */
export interface PayslipRow {
  id: string
  employee_id: string
  file_url: string
  file_name: string | null
}

/** What the payslip footer prints, from the org's letterhead settings. */
export interface PayslipCompany {
  name: string
  logoUrl: string | null
  address: string
  email: string | null
  website: string | null
}

export interface ConfirmationRow {
  id: string
  employee_id: string
  month: number
  year: number
  /** 0 whole month, 1 the 1st–15th, 2 the 16th–end (050). */
  period: number
  amount: number | string | null
  currency: string | null
  paid_on: string | null
  file_url: string | null
  file_name: string | null
  note: string | null
  status: 'pending' | 'submitted' | 'verified' | 'rejected'
  review_note: string | null
  verified_at: string | null
}

/**
 * One pay period of one employee, joined to its confirmation if any. Somebody
 * paid twice a month contributes two rows to a month (050).
 */
interface Row extends EmployeeRow {
  period: PayPeriod
  confirmation: ConfirmationRow | null
}

const PERIOD_SHORT: Record<PayPeriod, string> = {
  0: 'Whole month',
  1: '1st – 15th',
  2: '16th – end',
}

export function PayrollReview({
  employees, confirmations, payslips, company, month, year,
}: {
  employees: EmployeeRow[]
  confirmations: ConfirmationRow[]
  payslips: PayslipRow[]
  company: PayslipCompany
  month: number
  year: number
}) {
  const progressRouter = useProgressRouter()
  const [query, setQuery] = React.useState('')
  const [reviewing, setReviewing] = React.useState<Row | null>(null)
  const [issuing, setIssuing] = React.useState<EmployeeRow | null>(null)

  const payslipOf = React.useMemo(
    () => new Map(payslips.map((slip) => [slip.employee_id, slip])),
    [payslips]
  )

  const byEmployeePeriod = React.useMemo(
    () => new Map(confirmations.map((row) => [`${row.employee_id}:${row.period}`, row])),
    [confirmations]
  )

  const rows: Row[] = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return employees
      .filter(
        (person) =>
          !q ||
          [person.full_name, person.email, person.employee_code]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(q))
      )
      .flatMap((person) => {
        /*
         * The periods their schedule expects — plus any they actually uploaded
         * under a schedule they have since been moved off, so a confirmation
         * never silently drops out of the review.
         */
        const periods = new Set<PayPeriod>(periodsOf(person.schedule))
        for (const row of confirmations) {
          if (row.employee_id === person.id) periods.add(row.period as PayPeriod)
        }
        return Array.from(periods)
          .sort((a, b) => a - b)
          .map((period) => ({
            ...person,
            period,
            confirmation: byEmployeePeriod.get(`${person.id}:${period}`) ?? null,
          }))
      })
  }, [employees, byEmployeePeriod, query])

  const years = React.useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: 6 }, (_, index) => current - index)
  }, [])

  const confirmed = rows.filter((row) => row.confirmation?.status === 'verified').length
  const waiting = rows.filter((row) => row.confirmation?.status === 'submitted').length

  function setPeriod(nextMonth: number, nextYear: number) {
    progressRouter.push(`/org/payroll?month=${nextMonth}&year=${nextYear}`)
  }

  const columns: Column<Row>[] = [
    {
      key: 'employee',
      header: 'Employee',
      cell: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-8 shrink-0">
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
      key: 'period',
      header: 'Pay period',
      cell: (row) => (
        <span className="whitespace-nowrap text-[13px]">
          {PERIOD_SHORT[row.period]}
          {row.schedule === 'semi_monthly' ? (
            <span className="ml-1.5 rounded-full bg-page px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
              2× / month
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => (
        <span className="tabular block text-right">
          {row.confirmation?.amount != null && row.confirmation.currency
            ? formatMoney(Number(row.confirmation.amount), row.confirmation.currency)
            : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Confirmation',
      cell: (row) => <ConfirmationStatus status={row.confirmation?.status ?? null} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-[300px]',
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {/* One payslip per month, so only on each person's first row. */}
          {row.period === Math.min(...periodsOf(row.schedule)) ? (
            <PayslipActions
              slip={payslipOf.get(row.id) ?? null}
              fileName={payslipFileName(row.full_name || row.email?.split('@')[0] || 'employee', month, year)}
              onGenerate={() => setIssuing(row)}
            />
          ) : null}
          {row.confirmation?.file_url ? (
            <Button asChild size="sm" variant="ghost">
              <a
                href={`/api/files/view?key=${encodeURIComponent(row.confirmation.file_url)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Download />
                View
              </a>
            </Button>
          ) : null}
          {row.confirmation?.status === 'submitted' ? (
            <Button size="sm" onClick={() => setReviewing(row)}>
              Review
            </Button>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          value={String(month)}
          onChange={(event) => setPeriod(Number(event.target.value), year)}
          className="sm:w-44"
          aria-label="Month"
        >
          {MONTH_NAMES.map((name, index) => (
            <option key={name} value={index + 1}>{name}</option>
          ))}
        </Select>
        <Select
          value={String(year)}
          onChange={(event) => setPeriod(month, Number(event.target.value))}
          className="sm:w-32"
          aria-label="Year"
        >
          {years.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </Select>

        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search employees"
            aria-label="Search employees"
            className="pl-9"
          />
        </div>

        <p className="tabular shrink-0 text-sm text-ink-muted">
          {confirmed} of {rows.length} confirmed
          {waiting ? ` · ${waiting} to review` : ''}
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.id}:${row.period}`}
        empty={
          <EmptyState
            icon={Wallet}
            title="No employees"
            description="Add employees and they will appear here each month."
          />
        }
      />

      <ReviewDialog row={reviewing} onClose={() => setReviewing(null)} />
      <PayslipDialog
        employee={issuing}
        company={company}
        month={month}
        year={year}
        replacing={issuing ? payslipOf.has(issuing.id) : false}
        onClose={() => setIssuing(null)}
      />
    </div>
  )
}

function ConfirmationStatus({ status }: { status: ConfirmationRow['status'] | null }) {
  if (status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-600">
        <CheckCircle2 className="size-4" aria-hidden />
        Confirmed
      </span>
    )
  }
  if (status === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-ink">
        <Clock className="size-4" aria-hidden />
        Awaiting review
      </span>
    )
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-danger">
        <XCircle className="size-4" aria-hidden />
        Returned
      </span>
    )
  }
  return <StatusChip status="pending" label="Not uploaded" />
}

function ReviewDialog({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const router = useRouter()
  const [note, setNote] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'verified' | 'rejected' | null>(null)

  React.useEffect(() => {
    if (!row) return
    setNote('')
    setError(null)
    setBusy(null)
  }, [row])

  async function decide(status: 'verified' | 'rejected') {
    if (!row?.confirmation) return
    if (status === 'rejected' && !note.trim()) {
      setError('Tell them what is wrong with it.')
      return
    }

    setError(null)
    setBusy(status)
    try {
      await apiPatch(`/api/org/payments/${row.confirmation.id}`, {
        status,
        note: note.trim() || undefined,
      })
      toast.success(status === 'verified' ? 'Payment confirmed' : 'Sent back to the employee')
      onClose()
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const confirmation = row?.confirmation

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{row?.full_name || row?.email}</DialogTitle>
          <DialogDescription>
            {confirmation
              ? `${periodLabel(confirmation.year, confirmation.month, confirmation.period)} payment confirmation`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <FormError message={error} />

          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">Amount</dt>
              <dd className="tabular mt-0.5 text-sm">
                {confirmation?.amount != null && confirmation.currency
                  ? formatMoney(Number(confirmation.amount), confirmation.currency)
                  : 'Not stated'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Received on
              </dt>
              <dd className="tabular mt-0.5 text-sm">{confirmation?.paid_on || '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Document
              </dt>
              <dd className="mt-0.5 text-sm">
                {confirmation?.file_url ? (
                  <a
                    className="text-brand-ink hover:underline"
                    href={`/api/files/view?key=${encodeURIComponent(confirmation.file_url)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {confirmation.file_name || 'Open'}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>

          {confirmation?.note ? (
            <div className="rounded-lg bg-page px-3.5 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Their note
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{confirmation.note}</p>
            </div>
          ) : null}

          <FormField
            label="Note"
            hint="Required if you send it back — it is the only thing telling them what to fix."
          >
            <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
          </FormField>
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy === 'rejected'}
            disabled={busy === 'verified'}
            onClick={() => decide('rejected')}
          >
            Send back
          </Button>
          <Button
            loading={busy === 'verified'}
            disabled={busy === 'rejected'}
            onClick={() => decide('verified')}
          >
            <CheckCircle2 />
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PayslipActions({
  slip, fileName, onGenerate,
}: {
  slip: PayslipRow | null
  /** Always derived from the person and month, so older slips stored under a
      bare uuid still save as "Payslip-<name>-<Month>-<year>.pdf". */
  fileName: string
  onGenerate: () => void
}) {
  if (!slip) {
    return (
      <Button size="sm" variant="secondary" onClick={onGenerate}>
        <FileText />
        Payslip
      </Button>
    )
  }
  return (
    <>
      <Button asChild size="sm" variant="ghost">
        <a
          href={`/api/files/view?key=${encodeURIComponent(slip.file_url)}&name=${encodeURIComponent(fileName)}`}
          target="_blank"
          rel="noopener noreferrer"
          title={fileName}
        >
          <FileText />
          Payslip
        </a>
      </Button>
      <Button size="sm" variant="ghost" onClick={onGenerate}>
        Redo
      </Button>
    </>
  )
}

/** Remembered per browser: the two footer details the letterhead settings lack. */
const PAYSLIP_PREFS_KEY = 'payslip-footer'

function readPrefs(): { tagline?: string; queriesEmail?: string } | null {
  try {
    const raw = window.localStorage.getItem(PAYSLIP_PREFS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** One column of salary components, each amount editable in place. */
function BreakdownLines({
  title, lines, onChange,
}: {
  title: string
  lines: LineDraft[]
  onChange: (lines: LineDraft[]) => void
}) {
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
  // `min-w-0` matters: a <fieldset> defaults to `min-width: min-content`, which
  // let long labels push it out of its grid track and over the next column.
  return (
    <fieldset className="min-w-0 overflow-hidden rounded-xl border border-line">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center justify-between border-b border-line bg-page px-3.5 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</span>
        <span className="tabular text-xs font-semibold text-ink">
          {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <div className="divide-y divide-line">
      {lines.map((line, index) => (
        <div key={line.label} className="flex items-center gap-3 px-3.5 py-2">
          <span className="min-w-0 flex-1 text-sm leading-snug text-ink" title={line.label}>
            {line.label}
          </span>
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            aria-label={line.label}
            className="h-9 w-28 shrink-0 text-right tabular"
            value={line.amount}
            onChange={(event) =>
              onChange(
                lines.map((current, i) => (i === index ? { ...current, amount: event.target.value } : current))
              )
            }
          />
        </div>
      ))}
      </div>
    </fieldset>
  )
}

/** A salary component as typed: the amount stays a string until it is used. */
interface LineDraft {
  label: string
  amount: string
}

const toDrafts = (lines: PayslipLine[]): LineDraft[] =>
  lines.map((line) => ({ label: line.label, amount: String(line.amount) }))

const fromDrafts = (drafts: LineDraft[]): PayslipLine[] =>
  drafts.map((draft) => ({ label: draft.label.trim(), amount: Number(draft.amount || 0) }))

/** `2020-05-04` → `04-May-2020`, the way Indian slips print it. */
function formatJoiningDate(date: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '')
  if (!match) return ''
  return `${match[3]}-${MONTHS_LONG[Number(match[2]) - 1].slice(0, 3)}-${match[1]}`
}

/**
 * Generate one employee's payslip for the month on screen, in the org's
 * salary-slip layout (see `payslip-pdf.ts`). Everything is prefilled from the
 * profile and stays editable; "Preview" opens the PDF without saving, and
 * "Issue payslip" stores it where the employee can download it.
 */
function PayslipDialog({
  employee, company, month, year, replacing, onClose,
}: {
  employee: EmployeeRow | null
  company: PayslipCompany
  month: number
  year: number
  replacing: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [designation, setDesignation] = React.useState('')
  const [currency, setCurrency] = React.useState('INR')
  const [basis, setBasis] = React.useState<SalaryBasis>('annual')
  const [salary, setSalary] = React.useState('')
  const [workingDays, setWorkingDays] = React.useState('')
  const [deductions, setDeductions] = React.useState('0')
  const [tagline, setTagline] = React.useState('')
  const [queriesEmail, setQueriesEmail] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<'preview' | 'issue' | null>(null)
  // The itemised slip: Basic, HRA, … and PF, PT, TDS.
  const [detailed, setDetailed] = React.useState(false)
  const [employeeCode, setEmployeeCode] = React.useState('')
  const [dateOfJoining, setDateOfJoining] = React.useState('')
  const [pfNumber, setPfNumber] = React.useState('')
  const [bankDetails, setBankDetails] = React.useState('')
  const [earningLines, setEarningLines] = React.useState<LineDraft[]>([])
  const [deductionLines, setDeductionLines] = React.useState<LineDraft[]>([])

  React.useEffect(() => {
    if (!employee) return
    const code = (employee.pay_currency || 'INR').toUpperCase()
    const prefs = readPrefs()
    const monthly =
      employee.pay_rate != null
        ? (code === 'INR' ? Number(employee.pay_rate) / 12 : Number(employee.pay_rate))
        : 0
    const suggested = suggestBreakdown(Number.isFinite(monthly) ? monthly : 0)
    setDetailed(false)
    setEmployeeCode(employee.employee_code ?? '')
    setDateOfJoining(formatJoiningDate(employee.date_of_joining ?? employee.hire_date))
    setPfNumber('')
    setBankDetails(employee.bank_name ?? '')
    setEarningLines(toDrafts(suggested.earnings))
    setDeductionLines(toDrafts(suggested.deductions))

    // Last detailed slip wins over the defaults: same PF no., same split.
    let cancelled = false
    apiGet<{ details: PayslipBreakdown | null }>(
      `/api/org/payslips?employeeId=${encodeURIComponent(employee.id)}`
    )
      .then(({ details }) => {
        if (cancelled || !details) return
        setDetailed(true)
        setEmployeeCode(details.employeeCode || employee.employee_code || '')
        setDateOfJoining(details.dateOfJoining)
        setPfNumber(details.pfNumber)
        setBankDetails(details.bankDetails)
        setEarningLines(toDrafts(details.earnings))
        setDeductionLines(toDrafts(details.deductions))
      })
      .catch(() => {
        // Only a prefill — the defaults above stand.
      })

    setName(employee.full_name ?? '')
    setEmail(employee.email ?? '')
    setDesignation(employee.designation ?? '')
    setCurrency(code)
    // Rupee slips state the annual salary; the others the monthly figure.
    setBasis(code === 'INR' ? 'annual' : 'monthly')
    setSalary(employee.pay_rate != null ? String(employee.pay_rate) : '')
    setWorkingDays(String(daysInMonth(month, year)))
    setDeductions('0')
    setTagline(prefs?.tagline ?? '')
    setQueriesEmail(prefs?.queriesEmail ?? company.email ?? '')
    setError(null)
    setBusy(null)
    return () => {
      cancelled = true
    }
  }, [employee, month, year, company.email])

  const salaryValue = Number(salary)
  const monthlySalary = Math.round((basis === 'annual' ? salaryValue / 12 : salaryValue) * 100) / 100
  const breakdown: PayslipBreakdown | null = detailed
    ? {
        employeeCode: employeeCode.trim(),
        dateOfJoining: dateOfJoining.trim(),
        pfNumber: pfNumber.trim(),
        bankDetails: bankDetails.trim(),
        earnings: fromDrafts(earningLines),
        deductions: fromDrafts(deductionLines),
      }
    : null
  const earnings = breakdown ? sumLines(breakdown.earnings) : monthlySalary
  const deductionValue = breakdown ? sumLines(breakdown.deductions) : Number(deductions || 0)
  const code = currency.trim().toUpperCase()

  function autoSplit() {
    const pfLine = deductionLines.find((line) => line.label === 'PF Employee')
    const suggested = suggestBreakdown(monthlySalary, { withPf: !pfLine || Number(pfLine.amount) > 0 })
    setEarningLines(toDrafts(suggested.earnings))
    setDeductionLines(toDrafts(suggested.deductions))
  }

  function validate(): string | null {
    if (!name.trim()) return 'Enter the employee name.'
    if (!/^[A-Z]{3}$/.test(code)) return 'Currency must be a three-letter code, like INR or USD.'
    const days = Number(workingDays)
    if (!Number.isInteger(days) || days < 0 || days > 31) return 'Working days must be 0–31.'
    if (breakdown) {
      const lines = [...breakdown.earnings, ...breakdown.deductions]
      if (lines.some((line) => !Number.isFinite(line.amount) || line.amount < 0)) {
        return 'Every amount must be zero or more.'
      }
      if (earnings <= 0) return 'Enter the salary components.'
    } else {
      if (!Number.isFinite(salaryValue) || salaryValue <= 0) return 'Enter the salary.'
      if (!Number.isFinite(deductionValue) || deductionValue < 0) return 'Deductions cannot be negative.'
    }
    if (deductionValue > earnings) return 'Deductions cannot exceed the month’s earnings.'
    return null
  }

  async function build(): Promise<Blob> {
    try {
      window.localStorage.setItem(
        PAYSLIP_PREFS_KEY,
        JSON.stringify({ tagline: tagline.trim(), queriesEmail: queriesEmail.trim() })
      )
    } catch {
      // Remembering the footer is a convenience; blocked storage is fine.
    }
    const logo = await loadOrgLogo(company.logoUrl)
    return renderPayslip({
      org: {
        name: company.name,
        logo,
        tagline: tagline.trim(),
        address: company.address,
        email: company.email,
        website: company.website,
        queriesEmail: queriesEmail.trim() || null,
      },
      employeeName: name.trim(),
      employeeEmail: email.trim(),
      designation: designation.trim(),
      basis,
      salary: salaryValue,
      currency: code,
      workingDays: Number(workingDays),
      month,
      year,
      earnings,
      deductions: deductionValue,
      breakdown,
    })
  }

  async function run(mode: 'preview' | 'issue') {
    if (!employee) return
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setBusy(mode)
    // Opened inside the click so the popup blocker lets it through.
    const preview = mode === 'preview' ? window.open('', '_blank') : null
    try {
      const blob = await build()
      if (mode === 'preview') {
        const url = URL.createObjectURL(blob)
        if (preview) preview.location.href = url
        else window.open(url, '_blank')
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
        return
      }
      const fileName = payslipFileName(name, month, year)
      const file = new File([blob], fileName, { type: 'application/pdf' })
      const uploaded = await uploadFile(file, 'payslip')
      await apiPost('/api/org/payslips', {
        employeeId: employee.id,
        month,
        year,
        key: uploaded.key,
        fileName,
        details: breakdown,
      })
      toast.success(replacing ? 'Payslip replaced' : 'Payslip issued')
      onClose()
      router.refresh()
    } catch (err) {
      preview?.close()
      setError(err instanceof ApiClientError ? err.message : 'Could not generate the payslip.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={!!employee} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>
            Payslip — {MONTHS_LONG[month - 1]} {year}
          </DialogTitle>
          <DialogDescription>
            {replacing
              ? 'This month already has a payslip. Issuing again replaces it.'
              : 'Check the details, preview, then issue it to the employee.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <FormError message={error} />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Employee name">
              <Input value={name} onChange={(event) => setName(event.target.value)} />
            </FormField>
            <FormField label="Employee email">
              <Input value={email} onChange={(event) => setEmail(event.target.value)} />
            </FormField>
            <FormField label="Designation">
              <Input value={designation} onChange={(event) => setDesignation(event.target.value)} />
            </FormField>
            <FormField label="Currency">
              <Input
                value={currency}
                maxLength={3}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            </FormField>
            <FormField label="Salary stated as">
              <Select value={basis} onChange={(event) => setBasis(event.target.value as SalaryBasis)}>
                <option value="annual">Annual salary</option>
                <option value="monthly">Monthly salary</option>
              </Select>
            </FormField>
            <FormField label={basis === 'annual' ? 'Annual salary' : 'Monthly salary'}>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={salary}
                onChange={(event) => setSalary(event.target.value)}
              />
            </FormField>
            <FormField label="Working days in period">
              <Input
                type="number"
                min="0"
                max="31"
                value={workingDays}
                onChange={(event) => setWorkingDays(event.target.value)}
              />
            </FormField>
            {detailed ? null : (
              <FormField label="Total deductions">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={deductions}
                  onChange={(event) => setDeductions(event.target.value)}
                />
              </FormField>
            )}
            <FormField label="Tagline under company name" hint="e.g. Innovation & Technology">
              <Input value={tagline} onChange={(event) => setTagline(event.target.value)} />
            </FormField>
            <FormField label="Queries contact email">
              <Input
                type="email"
                value={queriesEmail}
                onChange={(event) => setQueriesEmail(event.target.value)}
              />
            </FormField>
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3.5 py-3 text-sm">
            <Checkbox checked={detailed} onChange={(event) => setDetailed(event.target.checked)} />
            <span>
              <span className="font-medium">Itemised slip with PF</span>
              <span className="block text-xs text-ink-muted">
                Adds Emp ID, date of joining, PF no. and bank details, and splits the salary into
                Basic, HRA and allowances with PF, Professional Tax and TDS deducted.
              </span>
            </span>
          </label>

          {detailed ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Emp ID">
                  <Input value={employeeCode} maxLength={40} onChange={(event) => setEmployeeCode(event.target.value)} />
                </FormField>
                <FormField label="Date of joining" hint="As printed, e.g. 04-May-2020">
                  <Input value={dateOfJoining} maxLength={40} onChange={(event) => setDateOfJoining(event.target.value)} />
                </FormField>
                <FormField label="PF No" hint="Leave blank if not enrolled">
                  <Input
                    value={pfNumber}
                    maxLength={60}
                    onChange={(event) => setPfNumber(event.target.value)}
                    placeholder="AP/HYD/2225273/10148"
                  />
                </FormField>
                <FormField label="Bank details">
                  <Input
                    value={bankDetails}
                    maxLength={120}
                    onChange={(event) => setBankDetails(event.target.value)}
                    placeholder="44511550017 / Standard Chartered"
                  />
                </FormField>
              </div>

              <div className="grid items-start gap-4 md:grid-cols-2">
                <BreakdownLines title="Earnings" lines={earningLines} onChange={setEarningLines} />
                <BreakdownLines title="Deductions" lines={deductionLines} onChange={setDeductionLines} />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="tabular text-ink-muted">
                  Gross <span className="font-medium text-ink">{payslipMoney(earnings, code || 'INR')}</span>
                  {' · '}Deductions{' '}
                  <span className="font-medium text-ink">{payslipMoney(deductionValue, code || 'INR')}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!(monthlySalary > 0)}
                  onClick={autoSplit}
                  title="Basic 50%, HRA 50% of Basic, CCA 10%, PF 12% of Basic (capped)"
                >
                  Split from salary
                </Button>
              </div>
            </div>
          ) : null}

          {earnings > 0 && /^[A-Z]{3}$/.test(code) ? (
            <div className="tabular flex items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm dark:border-brand-500/30 dark:bg-brand-500/10">
              <span className="font-medium text-ink">Net salary payable</span>
              <span className="text-base font-semibold text-ink">
                {payslipMoney(Math.max(0, earnings - deductionValue), code, { spaced: true })}
              </span>
            </div>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            loading={busy === 'preview'}
            disabled={busy === 'issue'}
            onClick={() => run('preview')}
          >
            Preview
          </Button>
          <Button
            loading={busy === 'issue'}
            disabled={busy === 'preview'}
            onClick={() => run('issue')}
          >
            <FileText />
            {replacing ? 'Replace payslip' : 'Issue payslip'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
