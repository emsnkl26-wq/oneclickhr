'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Receipt, Trash2, Pencil, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, StatusChip, type Column } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea, DateField } from '@/components/ui/input'
import { SearchField } from '@/components/ui/search-field'
import { FilterSelect } from '@/components/ui/filter-select'
import { Pagination } from '@/components/ui/pagination'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/fetcher'
import { computeTotals, lineAmount } from '@/lib/invoice'
import { formatMoney } from '@/lib/utils'
import { downloadInvoicePdf } from '@/lib/invoice-pdf'
import type { Invoice, InvoiceStatus } from '@/types/db'

interface DraftItem {
  description: string
  quantity: string
  rate: string
}

const EMPTY_ITEM: DraftItem = { description: '', quantity: '1', rate: '0' }

/** `invoices` is one page; the search and status filter live in the URL. */
export function InvoiceWorkspace({
  invoices, total, page, perPage, filtered, suggestedNumber, orgName, timezone,
}: {
  invoices: Invoice[]
  total: number
  page: number
  perPage: number
  filtered: boolean
  suggestedNumber: string
  orgName: string
  timezone: string
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<Invoice | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Invoice | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function onDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await apiDelete(`/api/org/invoices/${deleting.id}`)
      toast.success('Invoice deleted')
      setDeleting(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const columns: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice',
      cell: (row) => <span className="tabular font-medium">{row.invoice_number}</span>,
    },
    {
      key: 'billTo',
      header: 'Bill to',
      cell: (row) => <span className="truncate">{row.bill_to?.name || '—'}</span>,
    },
    {
      key: 'issued',
      header: 'Issued',
      cell: (row) => <span className="tabular whitespace-nowrap">{row.issue_date}</span>,
    },
    {
      key: 'due',
      header: 'Due',
      cell: (row) => (
        <span className="tabular whitespace-nowrap text-ink-muted">{row.due_date || '—'}</span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => (
        <span className="tabular block text-right font-medium">
          {formatMoney(row.total, row.currency)}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      className: 'text-right',
      headerClassName: 'text-right',
      cell: (row) => (
        <span
          className={`tabular block text-right ${
            Number(row.balance_due) > 0 ? 'font-medium text-ink' : 'text-ink-muted'
          }`}
        >
          {formatMoney(row.balance_due, row.currency)}
        </span>
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
      className: 'w-[120px]',
      cell: (row) => (
        <div className="flex justify-end gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Print ${row.invoice_number}`}
            onClick={() => downloadInvoicePdf(row, orgName)}
          >
            <Printer />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Edit ${row.invoice_number}`}
            onClick={() => setEditing(row)}
          >
            <Pencil />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Delete ${row.invoice_number}`}
            onClick={() => setDeleting(row)}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchField
          param="q"
          placeholder="Search by number or client"
          label="Search invoices"
        />
        <FilterSelect
          param="status"
          label="Filter by status"
          className="sm:w-44"
          options={[
            { value: '', label: 'All statuses' },
            { value: 'draft', label: 'Draft' },
            { value: 'sent', label: 'Sent' },
            { value: 'paid', label: 'Paid' },
            { value: 'overdue', label: 'Overdue' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
        />
        <Button onClick={() => setCreating(true)}>
          <Plus />
          New invoice
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={invoices}
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            icon={Receipt}
            title={filtered ? 'No matches' : 'No invoices yet'}
            description={
              filtered
                ? 'Try a different search or clear the filter.'
                : 'Create your first invoice to start tracking what you are owed.'
            }
            action={
              filtered ? undefined : (
                <Button onClick={() => setCreating(true)}>Create an invoice</Button>
              )
            }
          />
        }
      />

      <Pagination page={page} perPage={perPage} total={total} />

      <InvoiceDialog
        open={creating || !!editing}
        invoice={editing}
        suggestedNumber={suggestedNumber}
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

      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.invoice_number}?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              This cannot be undone. Consider marking it cancelled instead if you need the record.
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

function InvoiceDialog({
  open, invoice, suggestedNumber, onClose, onSaved,
}: {
  open: boolean
  invoice: Invoice | null
  suggestedNumber: string
  onClose: () => void
  onSaved: () => void
}) {
  const [invoiceNumber, setInvoiceNumber] = React.useState('')
  const [billToName, setBillToName] = React.useState('')
  const [billToEmail, setBillToEmail] = React.useState('')
  const [billToAddress, setBillToAddress] = React.useState('')
  const [items, setItems] = React.useState<DraftItem[]>([{ ...EMPTY_ITEM }])
  const [currency, setCurrency] = React.useState('USD')
  const [taxPercent, setTaxPercent] = React.useState('0')
  const [amountPaid, setAmountPaid] = React.useState('0')
  const [status, setStatus] = React.useState<InvoiceStatus>('draft')
  const [issueDate, setIssueDate] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  // Reset the form whenever the dialog opens, for create or for a given invoice.
  React.useEffect(() => {
    if (!open) return
    setError(null)
    setFields({})
    if (invoice) {
      setInvoiceNumber(invoice.invoice_number)
      setBillToName(invoice.bill_to?.name ?? '')
      setBillToEmail(invoice.bill_to?.email ?? '')
      setBillToAddress(invoice.bill_to?.address ?? '')
      setItems(
        (invoice.items ?? []).map((i) => ({
          description: i.description,
          quantity: String(i.quantity),
          rate: String(i.rate),
        }))
      )
      setCurrency(invoice.currency)
      setTaxPercent(String(invoice.tax_percent))
      setAmountPaid(String(invoice.amount_paid))
      setStatus(invoice.status)
      setIssueDate(invoice.issue_date)
      setDueDate(invoice.due_date ?? '')
      setNotes(invoice.notes ?? '')
    } else {
      setInvoiceNumber(suggestedNumber)
      setBillToName('')
      setBillToEmail('')
      setBillToAddress('')
      setItems([{ ...EMPTY_ITEM }])
      setCurrency('USD')
      setTaxPercent('0')
      setAmountPaid('0')
      setStatus('draft')
      setIssueDate(new Date().toISOString().slice(0, 10))
      setDueDate('')
      setNotes('')
    }
  }, [open, invoice, suggestedNumber])

  // Same helper the server uses, so the preview can never disagree with what
  // gets stored.
  const totals = React.useMemo(
    () =>
      computeTotals(
        items.map((i) => ({ quantity: Number(i.quantity) || 0, rate: Number(i.rate) || 0 })),
        Number(taxPercent) || 0,
        Number(amountPaid) || 0
      ),
    [items, taxPercent, amountPaid]
  )

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)

    const payload = {
      invoiceNumber,
      billTo: { name: billToName, email: billToEmail, address: billToAddress },
      items: items.map((i) => ({
        description: i.description,
        quantity: Number(i.quantity) || 0,
        rate: Number(i.rate) || 0,
      })),
      currency,
      taxPercent: Number(taxPercent) || 0,
      amountPaid: Number(amountPaid) || 0,
      status,
      issueDate,
      dueDate: dueDate || null,
      notes: notes || undefined,
    }

    try {
      if (invoice) {
        await apiPatch(`/api/org/invoices/${invoice.id}`, payload)
        toast.success('Invoice updated')
      } else {
        await apiPost('/api/org/invoices', payload)
        toast.success('Invoice created')
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
      <DialogContent size="lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{invoice ? `Edit ${invoice.invoice_number}` : 'New invoice'}</DialogTitle>
          </DialogHeader>

          <DialogBody className="space-y-5">
            <FormError message={error} />

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Invoice number" error={fields.invoiceNumber} required>
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Issue date" required>
                <DateField
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  required
                />
              </FormField>
              <FormField label="Due date">
                <DateField value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </FormField>
            </div>

            <fieldset className="space-y-4 rounded-xl border border-line p-4">
              <legend className="px-1.5 text-[13px] font-medium">Bill to</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Name" error={fields['billTo.name']} required>
                  <Input
                    value={billToName}
                    onChange={(e) => setBillToName(e.target.value)}
                    required
                  />
                </FormField>
                <FormField label="Email">
                  <Input
                    type="email"
                    value={billToEmail}
                    onChange={(e) => setBillToEmail(e.target.value)}
                  />
                </FormField>
              </div>
              <FormField label="Address">
                <Textarea
                  rows={2}
                  value={billToAddress}
                  onChange={(e) => setBillToAddress(e.target.value)}
                />
              </FormField>
            </fieldset>

            <div className="space-y-2">
              <p className="text-[13px] font-medium">Line items</p>
              <div className="space-y-2">
                {items.map((item, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <div className="flex-1">
                      <Input
                        value={item.description}
                        onChange={(e) => updateItem(index, { description: e.target.value })}
                        placeholder="Description"
                        aria-label={`Item ${index + 1} description`}
                        required
                      />
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, { quantity: e.target.value })}
                        aria-label={`Item ${index + 1} quantity`}
                        className="tabular"
                      />
                    </div>
                    <div className="w-28">
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        value={item.rate}
                        onChange={(e) => updateItem(index, { rate: e.target.value })}
                        aria-label={`Item ${index + 1} rate`}
                        className="tabular"
                      />
                    </div>
                    <div className="tabular w-24 pb-2 text-right text-sm font-medium">
                      {formatMoney(
                        lineAmount(Number(item.quantity) || 0, Number(item.rate) || 0),
                        currency
                      )}
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove item ${index + 1}`}
                      disabled={items.length === 1}
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
              >
                <Plus />
                Add line
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              <FormField label="Currency">
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                  maxLength={3}
                  className="tabular uppercase"
                />
              </FormField>
              <FormField label="Tax %">
                <Input
                  type="number"
                  step="any"
                  min="0"
                  max="100"
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(e.target.value)}
                  className="tabular"
                />
              </FormField>
              <FormField label="Amount paid">
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  className="tabular"
                />
              </FormField>
              <FormField label="Status">
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                >
                  <option value="draft">Draft</option>
                  <option value="sent">Sent</option>
                  <option value="paid">Paid</option>
                  <option value="overdue">Overdue</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </FormField>
            </div>

            <div className="space-y-1.5 rounded-xl bg-page p-4 text-sm">
              {[
                ['Subtotal', totals.subtotal],
                ['Tax', totals.tax],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between text-ink-muted">
                  <span>{label}</span>
                  <span className="tabular">{formatMoney(value as number, currency)}</span>
                </div>
              ))}
              <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular">{formatMoney(totals.total, currency)}</span>
              </div>
              <div className="flex justify-between font-medium text-brand-600">
                <span>Balance due</span>
                <span className="tabular">{formatMoney(totals.balanceDue, currency)}</span>
              </div>
            </div>

            <FormField label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {invoice ? 'Save changes' : 'Create invoice'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
