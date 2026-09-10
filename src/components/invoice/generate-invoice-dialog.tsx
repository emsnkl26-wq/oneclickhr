'use client'

/**
 * "Generate invoice" — from approved weeks, for one vendor.
 *
 * One component behind three buttons (an employee's page, a single timesheet,
 * and the queue's bulk action) because they are the same decision with a
 * different starting selection. Splitting them would mean three places to keep
 * the vendor rule in.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW: any money at all.
 *
 * The bill rate lives on the placement and the total is computed server-side
 * from it, so there is nothing to preview here without shipping rates to the
 * browser. The invoice opens immediately afterwards, with its real figures, and
 * it opens as a DRAFT — nothing has been sent to anybody until somebody says so.
 *
 * Weeks are grouped by vendor because an invoice goes to one company. Selecting
 * across two vendors is not an error to report at submit time; it is a choice
 * the UI should not offer, so picking a vendor filters the list.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { formatPeriod } from '@/lib/time'

/** An approved, not-yet-invoiced week. */
export interface BillableTimesheet {
  id: string
  code: string
  weekStart: string
  weekEnd: string
  billableHours: number
  vendorId: string | null
  vendorName: string | null
  employeeName: string
}

export function GenerateInvoiceDialog({
  open, timesheets, onClose, title = 'Generate invoice',
}: {
  open: boolean
  timesheets: BillableTimesheet[]
  onClose: () => void
  title?: string
}) {
  const router = useRouter()

  const vendors = React.useMemo(() => {
    const seen = new Map<string, string>()
    for (const sheet of timesheets) {
      if (sheet.vendorId) seen.set(sheet.vendorId, sheet.vendorName ?? 'Vendor')
    }
    return Array.from(seen, ([id, name]) => ({ id, name }))
  }, [timesheets])

  const [vendorId, setVendorId] = React.useState('')
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  // Opening picks the only vendor when there is only one, and pre-selects every
  // week for it — the common case is "bill everything outstanding".
  React.useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(false)
    const only = vendors.length === 1 ? vendors[0].id : ''
    setVendorId(only)
    setSelected(
      new Set(timesheets.filter((s) => !only || s.vendorId === only).map((s) => s.id))
    )
  }, [open, vendors, timesheets])

  const visible = vendorId ? timesheets.filter((s) => s.vendorId === vendorId) : timesheets
  const chosen = visible.filter((s) => selected.has(s.id))
  const hours = chosen.reduce((sum, s) => sum + s.billableHours, 0)

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    if (!chosen.length) {
      setError('Choose at least one week to invoice.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      const result = await apiPost<{ id: string; invoiceNumber: string }>(
        '/api/org/invoices/from-timesheets',
        { timesheetIds: chosen.map((s) => s.id) }
      )
      toast.success(`Invoice ${result.invoiceNumber} created as a draft`)
      onClose()
      router.push('/org/invoices')
      router.refresh()
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Approved weeks that have not been billed yet. The invoice is created as a draft, at the
            bill rate on each placement.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <FormError message={error} />

          {timesheets.length === 0 ? (
            <p className="text-sm text-ink-muted">
              There are no approved, uninvoiced weeks here yet. A week has to be approved before it
              can be billed.
            </p>
          ) : (
            <>
              {vendors.length > 1 ? (
                <FormField
                  label="Vendor"
                  hint="An invoice goes to one vendor, so pick which one this is for."
                  required
                >
                  <Select
                    value={vendorId}
                    onChange={(event) => {
                      const next = event.target.value
                      setVendorId(next)
                      setSelected(
                        new Set(timesheets.filter((s) => s.vendorId === next).map((s) => s.id))
                      )
                    }}
                  >
                    <option value="">Select a vendor</option>
                    {vendors.map((vendor) => (
                      <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                    ))}
                  </Select>
                </FormField>
              ) : null}

              <ul className="divide-y divide-line rounded-lg border border-line">
                {visible.map((sheet) => (
                  <li key={sheet.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3.5 py-2.5">
                      <Checkbox
                        checked={selected.has(sheet.id)}
                        onChange={() => toggle(sheet.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">
                          {formatPeriod(sheet.weekStart, sheet.weekEnd)}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          {sheet.code} · {sheet.employeeName}
                          {sheet.vendorName ? ` · ${sheet.vendorName}` : ''}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-sm">
                        {sheet.billableHours} h
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <p className="tabular text-sm text-ink-muted">
                {chosen.length} {chosen.length === 1 ? 'week' : 'weeks'} · {hours} billable hours
              </p>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy} disabled={!chosen.length}>
            <FileText />
            Create draft invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
