'use client'

import * as React from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, Paperclip, Pencil, Plus, Receipt, RefreshCw, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, DateField } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
  Tabs, TabsList, TabsTrigger, Switch,
} from '@/components/ui/primitives'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { apiPost, apiPatch, apiDelete, uploadFile, ApiClientError } from '@/lib/fetcher'
import {
  categoryLabel, formatMoney, type ExpenseTotal,
} from '@/lib/expenses'
import { expenseCategories } from '@/lib/schemas'
import { formatLocal } from '@/lib/time'
import type { Expense, ExpenseCategory, RecurringExpense } from '@/types/db'

/** Shift a `YYYY-MM` by whole months, without tripping over December. */
function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, m - 1 + by, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function ExpensesWorkspace({
  month, currency, timezone, expenses, recurring, logged, payrollTotal, revenueTotal, excluded,
}: {
  month: string
  currency: string
  timezone: string
  expenses: Expense[]
  recurring: RecurringExpense[]
  logged: ExpenseTotal
  payrollTotal: number
  revenueTotal: number
  excluded: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [tab, setTab] = React.useState<'ledger' | 'auto'>('ledger')
  const [editing, setEditing] = React.useState<Expense | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [editingRule, setEditingRule] = React.useState<RecurringExpense | null>(null)
  const [creatingRule, setCreatingRule] = React.useState(false)
  const [deleting, setDeleting] = React.useState<
    { kind: 'expense' | 'rule'; id: string; title: string } | null
  >(null)
  const [busy, setBusy] = React.useState(false)

  /*
   * Payroll is DERIVED from verified payment confirmations, never copied into
   * the ledger — see 033's header. It is added to the total here so "what did
   * this month cost" is answered in full, and shown as its own line so nobody
   * goes looking for the rows behind it.
   */
  const spend = logged.total + payrollTotal
  const profit = revenueTotal - spend

  function goToMonth(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', next)
    router.push(`${pathname}?${params.toString()}`)
  }

  async function onDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      const path =
        deleting.kind === 'expense'
          ? `/api/org/expenses/${deleting.id}`
          : `/api/org/expenses/recurring/${deleting.id}`
      await apiDelete(path)
      toast.success(deleting.kind === 'expense' ? 'Expense deleted' : 'Auto expense deleted')
      setDeleting(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* --- The month, and what it came to ---------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Previous month"
            onClick={() => goToMonth(shiftMonth(month, -1))}
          >
            <ChevronLeft />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-semibold">
            {monthLabel(month)}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Next month"
            onClick={() => goToMonth(shiftMonth(month, 1))}
          >
            <ChevronRight />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setCreatingRule(true)}>
            <RefreshCw />
            New auto expense
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus />
            Add expense
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Revenue collected" value={formatMoney(revenueTotal, currency)} />
        <Metric label="Total spend" value={formatMoney(spend, currency)} />
        <Metric
          label="Payroll"
          value={formatMoney(payrollTotal, currency)}
          hint="From verified payment confirmations."
        />
        <Metric
          label={profit >= 0 ? 'Profit' : 'Loss'}
          value={formatMoney(Math.abs(profit), currency)}
          tone={profit >= 0 ? 'good' : 'bad'}
        />
      </div>

      {excluded > 0 ? (
        /*
         * Said out loud rather than quietly converted. Adding 100 USD to 100 INR
         * gives 200 of nothing, and a conversion needs a rate, a date and a
         * source — any of which being wrong is worse than an honest omission.
         */
        <p className="rounded-lg border border-line bg-page px-3.5 py-2.5 text-[13px] text-ink-muted">
          {excluded} {excluded === 1 ? 'entry is' : 'entries are'} in another currency and{' '}
          {excluded === 1 ? 'is' : 'are'} not included in these totals. Nothing has been converted.
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="auto">Auto expenses ({recurring.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === 'ledger' ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <Card>
            {expenses.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="Nothing recorded this month"
                description="Add a cost, or set up an auto expense for the ones that repeat."
                action={<Button onClick={() => setCreating(true)}>Add expense</Button>}
              />
            ) : (
              <ul className="divide-y divide-line">
                {expenses.map((expense) => (
                  <li key={expense.id} className="flex items-start gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{expense.title}</p>
                        {expense.source === 'recurring' ? (
                          <StatusChip status="info" tone="info" label="Auto" />
                        ) : null}
                        {expense.receipt_url ? (
                          <a
                            href={`/api/files/view?key=${encodeURIComponent(expense.receipt_url)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline"
                          >
                            <Paperclip className="size-3" aria-hidden />
                            Receipt
                          </a>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[13px] text-ink-muted">
                        {categoryLabel(expense.category)}
                        {expense.vendor ? ` · ${expense.vendor}` : ''} ·{' '}
                        <span className="tabular">
                          {formatLocal(`${expense.spent_on}T12:00:00Z`, timezone, 'd MMM yyyy')}
                        </span>
                      </p>
                    </div>

                    <span className="tabular shrink-0 text-sm font-semibold">
                      {formatMoney(Number(expense.amount), expense.currency)}
                    </span>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${expense.title}`}
                        onClick={() => setEditing(expense)}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${expense.title}`}
                        onClick={() =>
                          setDeleting({ kind: 'expense', id: expense.id, title: expense.title })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Where it went</CardTitle>
            </CardHeader>
            <CardContent>
              {logged.byCategory.length === 0 && payrollTotal === 0 ? (
                <p className="text-[13px] text-ink-muted">Nothing to break down yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {payrollTotal > 0 ? (
                    <CategoryBar
                      label="Payroll"
                      amount={payrollTotal}
                      of={spend}
                      currency={currency}
                    />
                  ) : null}
                  {logged.byCategory.map((row) => (
                    <CategoryBar
                      key={row.category}
                      label={categoryLabel(row.category)}
                      amount={row.total}
                      of={spend}
                      currency={currency}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Auto expenses</CardTitle>
            <CardDescription>
              Each of these books one line into the ledger every month, on the day you choose.
              Editing one changes what it books next — it never rewrites what it has already
              booked.
            </CardDescription>
          </CardHeader>
          {recurring.length === 0 ? (
            <EmptyState
              icon={RefreshCw}
              title="No auto expenses yet"
              description="Set one up for the costs that repeat — subscriptions, rent, insurance."
              action={<Button onClick={() => setCreatingRule(true)}>New auto expense</Button>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {recurring.map((rule) => (
                <li key={rule.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{rule.title}</p>
                      {rule.is_active ? (
                        <StatusChip status="active" tone="success" label="Active" />
                      ) : (
                        <StatusChip status="neutral" tone="neutral" label="Paused" />
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-muted">
                      {categoryLabel(rule.category)}
                      {rule.vendor ? ` · ${rule.vendor}` : ''} · day {rule.day_of_month} of each
                      month
                      {rule.end_date ? ` · until ${rule.end_date}` : ''}
                    </p>
                  </div>

                  <span className="tabular shrink-0 text-sm font-semibold">
                    {formatMoney(Number(rule.amount), rule.currency)}
                  </span>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${rule.title}`}
                      onClick={() => setEditingRule(rule)}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${rule.title}`}
                      onClick={() => setDeleting({ kind: 'rule', id: rule.id, title: rule.title })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ExpenseDialog
        open={creating || !!editing}
        expense={editing}
        currency={currency}
        month={month}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => {
          setCreating(false)
          setEditing(null)
          router.refresh()
        }}
      />

      <RecurringDialog
        open={creatingRule || !!editingRule}
        rule={editingRule}
        currency={currency}
        onClose={() => {
          setCreatingRule(false)
          setEditingRule(null)
        }}
        onSaved={() => {
          setCreatingRule(false)
          setEditingRule(null)
          router.refresh()
        }}
      />

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{deleting?.title}&rdquo;?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              {deleting?.kind === 'rule'
                ? 'This stops it booking anything further. The expenses it has already booked stay in the ledger.'
                : 'This cannot be undone.'}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={onDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Metric({
  label, value, hint, tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'good' | 'bad'
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-ink-muted">{label}</p>
      <p
        className={`tabular mt-1 text-xl font-bold ${
          tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-danger' : ''
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-ink-muted">{hint}</p> : null}
    </Card>
  )
}

function CategoryBar({
  label, amount, of, currency,
}: {
  label: string
  amount: number
  of: number
  currency: string
}) {
  const share = of > 0 ? Math.round((amount / of) * 100) : 0
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tabular shrink-0 font-medium">{formatMoney(amount, currency)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-page">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${share}%` }} />
      </div>
    </li>
  )
}

function ExpenseDialog({
  open, expense, currency, month, onClose, onSaved,
}: {
  open: boolean
  expense: Expense | null
  currency: string
  month: string
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = React.useState('')
  const [vendor, setVendor] = React.useState('')
  const [category, setCategory] = React.useState<ExpenseCategory>('other')
  const [amount, setAmount] = React.useState('')
  const [spentOn, setSpentOn] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [receiptKey, setReceiptKey] = React.useState<string | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const fileInput = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setFields({})
    if (expense) {
      setTitle(expense.title)
      setVendor(expense.vendor ?? '')
      setCategory(expense.category)
      setAmount(String(expense.amount))
      setSpentOn(expense.spent_on)
      setDescription(expense.description ?? '')
      setReceiptKey(expense.receipt_url)
    } else {
      setTitle('')
      setVendor('')
      setCategory('other')
      setAmount('')
      // Defaults into the month being VIEWED, not today: someone catching up on
      // last month's receipts should not have to re-pick the date every time.
      setSpentOn(`${month}-01`)
      setDescription('')
      setReceiptKey(null)
    }
  }, [open, expense, month])

  async function onPickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const { key } = await uploadFile(file, 'expense_receipt')
      setReceiptKey(key)
      toast.success('Receipt attached')
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not upload that file')
    } finally {
      setUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    const payload = {
      title,
      vendor: vendor || undefined,
      category,
      amount,
      currency,
      spentOn,
      description: description || undefined,
      receiptKey: receiptKey ?? undefined,
    }

    try {
      if (expense) {
        await apiPatch(`/api/org/expenses/${expense.id}`, payload)
        toast.success('Expense updated')
      } else {
        await apiPost('/api/org/expenses', payload)
        toast.success('Expense recorded')
      }
      onSaved()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{expense ? 'Edit expense' : 'Add expense'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="What was this for?" error={fields.title} required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Figma team plan"
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={`Amount (${currency})`} error={fields.amount} required>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="45.00"
                  required
                />
              </FormField>
              <FormField label="Date" error={fields.spentOn} required>
                <DateField value={spentOn} onChange={(e) => setSpentOn(e.target.value)} required />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Category" error={fields.category}>
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                >
                  {expenseCategories.map((value) => (
                    <option key={value} value={value}>
                      {categoryLabel(value)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Paid to" error={fields.vendor}>
                <Input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="Figma Inc"
                />
              </FormField>
            </div>

            <FormField label="Receipt" hint="Optional. Stored privately with the rest of your files.">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  onChange={onPickFile}
                  className="sr-only"
                  aria-label="Attach a receipt"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip />
                  {uploading ? 'Uploading…' : receiptKey ? 'Replace receipt' : 'Attach a receipt'}
                </Button>
                {receiptKey ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setReceiptKey(null)}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            </FormField>

            <FormField label="Note" error={fields.description}>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={uploading}>
              {expense ? 'Save changes' : 'Add expense'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RecurringDialog({
  open, rule, currency, onClose, onSaved,
}: {
  open: boolean
  rule: RecurringExpense | null
  currency: string
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = React.useState('')
  const [vendor, setVendor] = React.useState('')
  const [category, setCategory] = React.useState<ExpenseCategory>('software')
  const [amount, setAmount] = React.useState('')
  const [dayOfMonth, setDayOfMonth] = React.useState('1')
  const [startDate, setStartDate] = React.useState('')
  const [endDate, setEndDate] = React.useState('')
  const [isActive, setIsActive] = React.useState(true)
  const [description, setDescription] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setError(null)
    setFields({})
    if (rule) {
      setTitle(rule.title)
      setVendor(rule.vendor ?? '')
      setCategory(rule.category)
      setAmount(String(rule.amount))
      setDayOfMonth(String(rule.day_of_month))
      setStartDate(rule.start_date)
      setEndDate(rule.end_date ?? '')
      setIsActive(rule.is_active)
      setDescription(rule.description ?? '')
    } else {
      setTitle('')
      setVendor('')
      setCategory('software')
      setAmount('')
      setDayOfMonth('1')
      setStartDate(new Date().toISOString().slice(0, 10))
      setEndDate('')
      setIsActive(true)
      setDescription('')
    }
  }, [open, rule])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    const payload = {
      title,
      vendor: vendor || undefined,
      category,
      amount,
      currency,
      dayOfMonth,
      startDate,
      endDate: endDate || null,
      isActive,
      description: description || undefined,
    }

    try {
      if (rule) {
        await apiPatch(`/api/org/expenses/recurring/${rule.id}`, payload)
        toast.success('Auto expense updated')
      } else {
        await apiPost('/api/org/expenses/recurring', payload)
        toast.success('Auto expense created')
      }
      onSaved()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{rule ? 'Edit auto expense' : 'New auto expense'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <FormError message={error} />

            <FormField label="What is this for?" error={fields.title} required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Figma team plan"
                required
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label={`Amount (${currency})`} error={fields.amount} required>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="45.00"
                  required
                />
              </FormField>
              {/*
                1–28 only. 29, 30 and 31 do not exist in every month, so a rule
                set to the 31st would silently skip five of them. Capping the
                choice is honest; a footnote explaining the gap is not.
              */}
              <FormField
                label="Books on"
                error={fields.dayOfMonth}
                hint="Day of the month. Capped at 28 so it never skips a short month."
              >
                <Select value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)}>
                  {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((day) => (
                    <option key={day} value={day}>
                      Day {day}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Category" error={fields.category}>
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                >
                  {expenseCategories.map((value) => (
                    <option key={value} value={value}>
                      {categoryLabel(value)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Paid to" error={fields.vendor}>
                <Input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="Figma Inc"
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Starts" error={fields.startDate} required>
                <DateField
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Ends" error={fields.endDate} hint="Leave blank to keep going.">
                <DateField value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </FormField>
            </div>

            <div className="flex items-start gap-3 rounded-lg bg-page p-3.5">
              <Switch id="rule-active" checked={isActive} onCheckedChange={setIsActive} />
              <label htmlFor="rule-active" className="cursor-pointer">
                <span className="block text-sm font-medium">Active</span>
                <span className="mt-0.5 block text-xs text-ink-muted">
                  Pausing stops the next one. It never removes what has already been booked.
                </span>
              </label>
            </div>

            <FormField label="Note" error={fields.description}>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {rule ? 'Save changes' : 'Create auto expense'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
