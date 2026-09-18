'use client'

import * as React from 'react'
import { CurrencySelect } from '@/components/ui/currency-select'
import { useRouter } from 'next/navigation'
import { Plus, Receipt, Trash2, Pencil, Printer, CircleCheck } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable, EmptyState, type Column } from '@/components/ui/patterns'
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
import { InvoicePreview, type PreviewOrg } from '@/components/invoice/invoice-preview'
import { formatMoney } from '@/lib/utils'
import { downloadInvoicePdf } from '@/lib/invoice-pdf'
import {
  INVOICE_STATUSES, INVOICE_STATUS_LABELS, InvoiceStatusChip,
} from '@/components/invoice/invoice-status'
import type { Invoice, InvoiceStatus } from '@/types/db'

interface DraftItem {
  description: string
  quantity: string
  rate: string
}

const EMPTY_ITEM: DraftItem = { description: '', quantity: '1', rate: '0' }

/** `invoices` is one page; the search and status filter live in the URL. */
export function InvoiceWorkspace({
  invoices, total, page, perPage, filtered, suggestedNumber, orgName, orgLogoUrl, orgPrimaryColor,
  orgAddressLines, orgEmail, orgPhone,
  timezone, today,
}: {
  invoices: Invoice[]
  total: number
  page: number
  perPage: number
  filtered: boolean
  suggestedNumber: string
  orgName: string
  orgLogoUrl: string | null
  orgPrimaryColor: string | null
  orgAddressLines: string[]
  orgEmail: string | null
  orgPhone: string | null
  timezone: string
  /** The tenant's today, so the chip and the server agree on what is overdue. */
  today: string
}) {
  const router = useRouter()
  const [editing, setEditing] = React.useState<Invoice | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deleting, setDeleting] = React.useState<Invoice | null>(null)
  const [marking, setMarking] = React.useState<Invoice | null>(null)
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
      cell: (row) => (
        <div className="flex flex-col items-start gap-0.5">
          <InvoiceStatusChip invoice={row} today={today} />
          {row.paid_at ? (
            <span className="tabular text-[11px] text-ink-muted">Paid {row.paid_at}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-[160px]',
      cell: (row) => (
        <div className="flex justify-end gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Update status of ${row.invoice_number}`}
            title="Update status"
            onClick={() => setMarking(row)}
          >
            <CircleCheck />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Print ${row.invoice_number}`}
            onClick={() =>
              downloadInvoicePdf(row, orgName, { logoUrl: orgLogoUrl, primaryColor: orgPrimaryColor })
            }
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
            ...INVOICE_STATUSES.map((value) => ({ value, label: INVOICE_STATUS_LABELS[value] })),
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
        today={today}
        org={{
          name: orgName,
          logoKey: orgLogoUrl,
          primaryColor: orgPrimaryColor ?? '#C41E33',
          addressLines: orgAddressLines,
          email: orgEmail,
          phone: orgPhone,
        }}
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

      <StatusDialog
        invoice={marking}
        today={today}
        onClose={() => setMarking(null)}
        onSaved={() => {
          setMarking(null)
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
  open, invoice, suggestedNumber, org, today, onClose, onSaved,
}: {
  open: boolean
  invoice: Invoice | null
  org: PreviewOrg
  suggestedNumber: string
  today: string
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
  const [paidAt, setPaidAt] = React.useState('')
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
      setPaidAt(invoice.paid_at ?? '')
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
      setPaidAt('')
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
      paidAt: status === 'paid' || status === 'partially_paid' ? paidAt || today : null,
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
      <DialogContent size="xl">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{invoice ? `Edit ${invoice.invoice_number}` : 'New invoice'}</DialogTitle>
          </DialogHeader>

          {/*
            Form on the left, the actual invoice on the right.

            The preview is not decoration: an invoice is a document somebody
            sends to another company, and the question people ask while filling
            this in is "what will they see?" — which a stack of form fields
            cannot answer. It stacks underneath on narrow screens rather than
            being hidden, because that question does not go away on a laptop.
          */}
          <DialogBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="space-y-5">
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
                <CurrencySelect value={currency} onChange={setCurrency} />
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
                  {INVOICE_STATUSES.map((value) => (
                    <option key={value} value={value}>{INVOICE_STATUS_LABELS[value]}</option>
                  ))}
                </Select>
              </FormField>
            </div>

            {status === 'paid' || status === 'partially_paid' ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Paid on" error={fields.paidAt}>
                  <DateField value={paidAt || today} onChange={(e) => setPaidAt(e.target.value)} />
                </FormField>
              </div>
            ) : null}

            <FormField label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </div>

          {/*
            Sticky so the document stays in view while the line items grow past
            a screenful — the moment the preview is most useful is exactly when
            the form is longest.
          */}
          <div className="lg:sticky lg:top-0 lg:self-start">
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-muted">
              Preview
            </p>
            <InvoicePreview
              org={org}
              invoice={{
                invoiceNumber,
                issueDate,
                dueDate,
                currency,
                taxPercent: Number(taxPercent) || 0,
                amountPaid: Number(amountPaid) || 0,
                notes,
                billTo: { name: billToName, email: billToEmail, address: billToAddress },
                items: items.map((item) => ({
                  description: item.description,
                  quantity: Number(item.quantity) || 0,
                  rate: Number(item.rate) || 0,
                })),
              }}
            />
          </div>
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

/**
 * The quick "mark as …" action: status, the date the money arrived, and for a
 * part payment how much of it — without reopening the whole document.
 */
function StatusDialog({
  invoice, today, onClose, onSaved,
}: {
  invoice: Invoice | null
  today: string
  onClose: () => void
  onSaved: () => void
}) {
  const [status, setStatus] = React.useState<InvoiceStatus>('paid')
  const [paidAt, setPaidAt] = React.useState('')
  const [amountPaid, setAmountPaid] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!invoice) return
    setError(null)
    // Opens on "Paid" for anything not yet paid — that is what someone clicking
    // this nearly always wants — and on the current status otherwise.
    setStatus(invoice.status === 'paid' || invoice.status === 'cancelled' ? invoice.status : 'paid')
    setPaidAt(invoice.paid_at ?? today)
    setAmountPaid(String(invoice.amount_paid ?? 0))
  }, [invoice, today])

  const needsDate = status === 'paid' || status === 'partially_paid'

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!invoice) return
    setError(null)
    setSubmitting(true)
    try {
      await apiPost(`/api/org/invoices/${invoice.id}/status`, {
        status,
        paidAt: needsDate ? paidAt || today : null,
        amountPaid: status === 'partially_paid' ? Number(amountPaid) || 0 : undefined,
      })
      toast.success(`Marked ${INVOICE_STATUS_LABELS[status].toLowerCase()}`)
      onSaved()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!invoice} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Update {invoice?.invoice_number}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4 pb-4">
            <FormError message={error} />
            {invoice ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <span>
                  Total{' '}
                  <span className="tabular font-medium text-ink">
                    {formatMoney(invoice.total, invoice.currency)}
                  </span>
                </span>
                <span aria-hidden>·</span>
                <InvoiceStatusChip invoice={invoice} today={today} />
              </div>
            ) : null}
            <FormField label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as InvoiceStatus)}>
                {INVOICE_STATUSES.map((value) => (
                  <option key={value} value={value}>{INVOICE_STATUS_LABELS[value]}</option>
                ))}
              </Select>
            </FormField>
            {status === 'partially_paid' ? (
              <FormField label="Amount received so far" required>
                <Input
                  type="number"
                  step="any"
                  min="0"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  className="tabular"
                  required
                />
              </FormField>
            ) : null}
            {needsDate ? (
              <FormField label="Paid on" required>
                <DateField value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
              </FormField>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
