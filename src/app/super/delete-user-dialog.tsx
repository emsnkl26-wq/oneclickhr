'use client'

/**
 * Permanently delete one employee or job seeker from the platform console (053).
 *
 * Two steps: read what goes, then type their email, give a reason and
 * re-enter your own password. The server re-checks all of it.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiDelete, ApiClientError } from '@/lib/fetcher'

export interface DeletableUser {
  id: string
  name: string | null
  email: string
  role: 'employee' | 'candidate'
  organization?: string | null
}

export function DeleteUserDialog({
  user, onClose, afterDelete,
}: {
  user: DeletableUser | null
  onClose: () => void
  /** Where to go once it is done; stays on the page (refreshed) when omitted. */
  afterDelete?: string
}) {
  const router = useRouter()
  const [step, setStep] = React.useState<1 | 2>(1)
  const [confirmEmail, setConfirmEmail] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!user) return
    setStep(1)
    setConfirmEmail('')
    setReason('')
    setPassword('')
    setError(null)
  }, [user])

  async function destroy() {
    if (!user) return
    setError(null)
    setBusy(true)
    try {
      await apiDelete(`/api/super/users/${user.id}`, { confirmEmail, password, reason })
      toast.success(`${user.name || user.email} has been deleted`)
      onClose()
      if (afterDelete) router.replace(afterDelete)
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  const emailMatches = !!user && confirmEmail.trim().toLowerCase() === user.email.toLowerCase()

  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Delete {user?.name || user?.email}?</DialogTitle>
          <DialogDescription>Step {step} of 2 — this cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormError message={error} />
          {step === 1 ? (
            <div className="space-y-2 text-sm text-ink-muted">
              <p>
                This removes the {user?.role === 'candidate' ? 'job seeker' : 'employee'}{' '}
                <span className="font-medium text-ink">{user?.email}</span>
                {user?.organization ? ` from ${user.organization}` : ''} completely:
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>their sign-in and profile</li>
                {user?.role === 'employee' ? (
                  <li>their attendance, leave, timesheets, documents and work authorization records</li>
                ) : (
                  <li>their saved CV and candidate profile</li>
                )}
                <li>every job application they sent</li>
              </ul>
              <p>Shared records that only mention them (invoices, tasks) are kept without their name.</p>
            </div>
          ) : (
            <>
              <FormField label={`Type their email: ${user?.email ?? ''}`}>
                <Input
                  type="email"
                  value={confirmEmail}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  autoComplete="off"
                  aria-invalid={!!confirmEmail && !emailMatches}
                />
              </FormField>
              <FormField label="Why?" hint="Kept in the audit log.">
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              </FormField>
              <FormField label="Your password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </FormField>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={() => (step === 1 ? onClose() : setStep(1))}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          {step === 1 ? (
            <Button variant="danger" onClick={() => setStep(2)}>
              Continue
            </Button>
          ) : (
            <Button
              variant="danger"
              loading={busy}
              disabled={!emailMatches || !password || reason.trim().length < 5}
              onClick={destroy}
            >
              <Trash2 />
              Delete permanently
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
