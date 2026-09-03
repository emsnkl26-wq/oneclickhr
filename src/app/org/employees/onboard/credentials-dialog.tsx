'use client'

/**
 * The hand-over screen for a LEGACY draft — one started before the account came
 * first, and invited from inside the wizard's action bar.
 *
 * It is a dialog rather than a page because of where it is raised: the wizard is
 * mid-form and must stay exactly where it is. The screen after "Add employee"
 * (`create-employee-form.tsx`) shows the same panel full-width, because there
 * the credentials ARE the page.
 */

import * as React from 'react'
import { Check, PartyPopper } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { CredentialsPanel } from './credentials-panel'
import type { NewCredentials } from '@/lib/new-credentials'

export function CredentialsDialog({
  credentials, name, open, onOpenChange, onContinue, onDone,
}: {
  credentials: NewCredentials
  /** Who the credentials belong to, for the copy. */
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Carry on filling in the rest of the details as the organization. */
  onContinue: () => void
  /** Leave it with the employee. */
  onDone: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PartyPopper className="size-5 text-brand-600" aria-hidden />
            {name}&rsquo;s account is ready
          </DialogTitle>
          <DialogDescription>
            They can sign in now and fill in the rest of their onboarding details themselves.
            You will be asked to review what they submit before it becomes their profile.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pb-4">
          <CredentialsPanel credentials={credentials} />
        </DialogBody>

        <DialogFooter>
          <Button variant="secondary" onClick={onContinue}>
            Keep filling this in
          </Button>
          <Button onClick={onDone}>
            <Check />
            Done — they&rsquo;ll finish it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
