'use client'

/**
 * The button that opens `GenerateInvoiceDialog`.
 *
 * A separate file from the dialog because the pages that host it are SERVER
 * components: they can render a client component, but they cannot hold the
 * `open` state a dialog needs. This is the smallest possible piece of client
 * code that closes that gap.
 *
 * It is rendered even when there is nothing to bill, and disabled with an
 * explanation instead. A button that appears and disappears depending on
 * invisible state teaches people that the feature is unreliable; one that is
 * present and says why it cannot be used teaches them how the feature works.
 */

import * as React from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GenerateInvoiceDialog, type BillableTimesheet } from './generate-invoice-dialog'

export function GenerateInvoiceButton({
  timesheets, employeeName,
}: {
  timesheets: BillableTimesheet[]
  employeeName?: string
}) {
  const [open, setOpen] = React.useState(false)
  const none = timesheets.length === 0

  return (
    <>
      <Button
        variant={none ? 'secondary' : 'default'}
        onClick={() => setOpen(true)}
        disabled={none}
        title={
          none
            ? 'There are no approved, uninvoiced weeks to bill yet.'
            : `Bill ${timesheets.length} approved ${timesheets.length === 1 ? 'week' : 'weeks'}`
        }
      >
        <FileText />
        Generate invoice
      </Button>

      <GenerateInvoiceDialog
        open={open}
        timesheets={timesheets}
        onClose={() => setOpen(false)}
        title={employeeName ? `Invoice for ${employeeName}` : 'Generate invoice'}
      />
    </>
  )
}
