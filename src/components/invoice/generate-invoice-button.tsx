'use client'

/**
 * The button that opens `GenerateInvoiceDialog`.
 *
 * A separate file from the dialog because the pages that host it are SERVER
 * components: they can render a client component, but they cannot hold the
 * `open` state a dialog needs. This is the smallest possible piece of client
 * code that closes that gap.
 *
 * On an employee's page it is ALWAYS usable: with no approved weeks to bill
 * from, the dialog offers an invoice entered by hand, filled from the person's
 * placement. Elsewhere, with nothing to bill, it is disabled with an
 * explanation — a button that appears and disappears depending on invisible
 * state teaches people that the feature is unreliable.
 */

import * as React from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GenerateInvoiceDialog, type BillableTimesheet } from './generate-invoice-dialog'

export function GenerateInvoiceButton({
  timesheets, employeeName, employeeId,
}: {
  timesheets: BillableTimesheet[]
  employeeName?: string
  /** Enables the manual invoice, pre-filled from this person's placement. */
  employeeId?: string
}) {
  const [open, setOpen] = React.useState(false)
  const none = timesheets.length === 0
  const manualHref = employeeId
    ? `/org/invoices?new=employee&employee=${encodeURIComponent(employeeId)}`
    : undefined
  const unusable = none && !manualHref

  return (
    <>
      <Button
        variant={unusable ? 'secondary' : 'default'}
        onClick={() => setOpen(true)}
        disabled={unusable}
        title={
          unusable
            ? 'There are no approved, uninvoiced weeks to bill yet.'
            : none
              ? 'No approved weeks to bill — create one by hand'
              : `Bill ${timesheets.length} approved ${timesheets.length === 1 ? 'week' : 'weeks'}`
        }
      >
        <FileText />
        Generate invoice
      </Button>

      <GenerateInvoiceDialog
        open={open}
        timesheets={timesheets}
        manualHref={manualHref}
        onClose={() => setOpen(false)}
        title={employeeName ? `Invoice for ${employeeName}` : 'Generate invoice'}
      />
    </>
  )
}
