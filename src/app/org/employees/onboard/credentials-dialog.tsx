'use client'

/**
 * The hand-over screen: an account exists, and here is what to give the person.
 *
 * It is a DIALOG rather than a page because of what it is holding. The
 * temporary password is returned exactly once and stored nowhere — not in the
 * URL, not in the database, not in this component's parent — so the moment it
 * is on screen the only useful thing anyone can do with it is copy it or send
 * it. A route would put it in history; a card further down the page would let
 * it scroll away. This asks for the decision while the value still exists.
 */

import * as React from 'react'
import { Check, Copy, Mail, MailX, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
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
  const summary = [
    `Sign-in page: ${credentials.loginUrl}`,
    `Email: ${credentials.email}`,
    credentials.tempPassword ? `Temporary password: ${credentials.tempPassword}` : null,
  ]
    .filter(Boolean)
    .join('\n')

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

        <DialogBody className="space-y-4 pb-4">
          <div className="space-y-3 rounded-xl border border-line bg-page p-4">
            <Detail label="Sign-in page" value={credentials.loginUrl} mono />
            <Detail label="Email" value={credentials.email} />
            {credentials.tempPassword ? (
              <Detail label="Temporary password" value={credentials.tempPassword} mono />
            ) : null}
          </div>

          <div
            className={cn(
              'flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed',
              credentials.emailSent
                ? 'border-emerald-200 bg-emerald-50/60 text-emerald-900'
                : 'border-line bg-page text-ink-muted'
            )}
          >
            {credentials.emailSent ? (
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden />
            ) : (
              <MailX className="mt-0.5 size-4 shrink-0" aria-hidden />
            )}
            <span>
              {credentials.emailSent ? (
                <>
                  These details have been emailed to <strong>{credentials.email}</strong>. Copy the
                  password anyway if you would rather pass it on yourself — it cannot be shown again
                  once this closes.
                </>
              ) : (
                <>
                  No email was sent, so this is the only copy of the password. Copy it now — it is
                  stored nowhere and cannot be shown again. A fresh one can be issued from their
                  employee page at any time.
                </>
              )}
            </span>
          </div>

          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              navigator.clipboard.writeText(summary)
              toast.success('Sign-in details copied')
            }}
          >
            <Copy />
            Copy all sign-in details
          </Button>
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

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span
          className={cn(
            'min-w-0 flex-1 break-all text-sm font-medium',
            mono && 'rounded-lg border border-line bg-card px-3 py-2 font-mono'
          )}
        >
          {value}
        </span>
        <Button
          variant="secondary"
          size="icon"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => {
            navigator.clipboard.writeText(value)
            toast.success('Copied')
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}
