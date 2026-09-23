'use client'

import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiDelete, ApiClientError } from '@/lib/fetcher'

/**
 * The confirmation for PERMANENTLY deleting an employee.
 *
 * Irreversible, so it asks for more than a click: the org types the person's
 * name (or DELETE, when there is no name yet) before the button unlocks, and the
 * dialog says plainly what goes with them. `endpoint` is whichever route owns
 * the record — the employee's own, or their onboarding's.
 */
export function DeleteEmployeeDialog({
  open, onOpenChange, name, endpoint, onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Printed in the copy and, when present, what must be typed to confirm. */
  name: string | null
  endpoint: string
  onDeleted: () => void
}) {
  const [typed, setTyped] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const phrase = name?.trim() || 'DELETE'
  const matches = typed.trim().toLowerCase() === phrase.toLowerCase()

  React.useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  async function remove() {
    if (!matches) return
    setBusy(true)
    try {
      await apiDelete(endpoint)
      toast.success(`${name?.trim() || 'Employee'} was deleted`)
      onOpenChange(false)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'The employee could not be deleted')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete {name?.trim() || 'this employee'} permanently?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="flex gap-2.5 rounded-lg border border-danger/30 bg-danger/5 px-3.5 py-3 text-[13px] text-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <div className="space-y-1.5">
              <p>Their sign-in is removed straight away, together with everything that is theirs:</p>
              <p className="text-ink-muted">
                profile and onboarding details, attendance, leave, timesheets, payslips and the
                documents filed under them.
              </p>
              <p className="text-ink-muted">
                Shared records such as invoices and tasks are kept, without their name. To keep their
                history instead, deactivate them.
              </p>
            </div>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-ink">
              Type <span className="font-semibold">{phrase}</span> to confirm
            </span>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') void remove()
              }}
            />
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} disabled={!matches} onClick={remove}>
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
