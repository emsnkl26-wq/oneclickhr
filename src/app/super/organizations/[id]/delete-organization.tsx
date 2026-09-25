'use client'

/**
 * The danger zone for one organization (053).
 *
 * Deleting is three deliberate steps, and the server re-checks every one:
 *
 *   0. the workspace is SUSPENDED first — instant, reversible, and it locks
 *      everybody out before anything is removed;
 *   1. read what will go (the counts), and acknowledge it cannot be undone;
 *   2. type the organization's exact name and the word DELETE;
 *   3. re-enter your own password and give a reason for the audit log.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Ban, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiDelete, apiPatch, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'

export interface OrgImpact {
  employees: number
  admins: number
  invoices: number
  timesheets: number
  jobs: number
  documents: number
}

export function DeleteOrganization({
  tenantId, name, status, impact,
}: {
  tenantId: string
  name: string
  status: 'active' | 'suspended'
  impact: OrgImpact
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [confirmName, setConfirmName] = React.useState('')
  const [phrase, setPhrase] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [suspending, setSuspending] = React.useState(false)

  function reset() {
    setStep(1)
    setAcknowledged(false)
    setConfirmName('')
    setPhrase('')
    setPassword('')
    setReason('')
    setError(null)
  }

  async function suspend() {
    setSuspending(true)
    try {
      await apiPatch(`/api/super/tenants/${tenantId}`, {
        status: 'suspended',
        reason: 'Suspended ahead of permanent deletion',
      })
      toast.success('Organization suspended')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Could not suspend it.')
    } finally {
      setSuspending(false)
    }
  }

  async function destroy() {
    setError(null)
    setBusy(true)
    try {
      await apiDelete(`/api/super/tenants/${tenantId}`, {
        confirmName,
        confirmPhrase: phrase,
        password,
        reason,
      })
      toast.success(`${name} has been deleted`)
      setOpen(false)
      router.replace('/super/organizations')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  const nameMatches = confirmName.trim() === name.trim()
  const rows: Array<[string, number]> = [
    ['Employee accounts', impact.employees],
    ['Administrator accounts', impact.admins],
    ['Timesheets', impact.timesheets],
    ['Invoices', impact.invoices],
    ['Job postings (and their applications)', impact.jobs],
    ['Documents', impact.documents],
  ]

  return (
    <section className="rounded-xl border border-red-200 bg-card p-5 shadow-sm dark:border-red-500/30">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-red-700 dark:text-red-400">
        <AlertTriangle className="size-4" aria-hidden />
        Danger zone
      </h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        Permanently delete this organization: every account, record and file in it. This cannot be
        undone. {status === 'active' ? 'Suspend it first — that locks everyone out immediately and can be reversed.' : ''}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {status === 'active' ? (
          <Button variant="secondary" loading={suspending} onClick={suspend}>
            <Ban />
            Suspend organization
          </Button>
        ) : null}
        <Button
          variant="danger"
          disabled={status !== 'suspended'}
          title={status !== 'suspended' ? 'Suspend the organization first' : undefined}
          onClick={() => {
            reset()
            setOpen(true)
          }}
        >
          <Trash2 />
          Delete organization…
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
            <DialogDescription>Step {step} of 3 — this cannot be undone.</DialogDescription>
            <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden>
              {[1, 2, 3].map((n) => (
                <span
                  key={n}
                  className={cn('h-1 rounded-full', n <= step ? 'bg-red-600' : 'bg-line')}
                />
              ))}
            </div>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <FormError message={error} />

            {step === 1 ? (
              <>
                <p className="text-sm text-ink-muted">Everything below is removed for good:</p>
                <dl className="divide-y divide-line rounded-lg border border-line">
                  {rows.map(([label, count]) => (
                    <div key={label} className="flex items-center justify-between px-3.5 py-2 text-sm">
                      <dt className="text-ink-muted">{label}</dt>
                      <dd className="tabular font-semibold">{count}</dd>
                    </div>
                  ))}
                </dl>
                <label className="flex cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    className="mt-0.5 size-4 accent-red-600"
                  />
                  I understand every account, record and file of this organization will be
                  permanently deleted.
                </label>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <FormField label={`Type the organization name: ${name}`}>
                  <Input
                    value={confirmName}
                    onChange={(e) => setConfirmName(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={!!confirmName && !nameMatches}
                  />
                </FormField>
                <FormField label="Type DELETE to confirm">
                  <Input
                    value={phrase}
                    onChange={(e) => setPhrase(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </FormField>
              </>
            ) : null}

            {step === 3 ? (
              <>
                <FormField label="Why is it being deleted?" hint="Kept in the audit log.">
                  <Textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                  />
                </FormField>
                <FormField label="Your password" hint="Re-enter it to confirm it is you.">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                </FormField>
              </>
            ) : null}
          </DialogBody>

          <DialogFooter>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => (step === 1 ? setOpen(false) : setStep((s) => (s - 1) as 1 | 2))}
            >
              {step === 1 ? 'Cancel' : 'Back'}
            </Button>
            {step < 3 ? (
              <Button
                variant="danger"
                disabled={step === 1 ? !acknowledged : !nameMatches || phrase !== 'DELETE'}
                onClick={() => setStep((s) => (s + 1) as 2 | 3)}
              >
                Continue
              </Button>
            ) : (
              <Button
                variant="danger"
                loading={busy}
                disabled={!password || reason.trim().length < 5}
                onClick={destroy}
              >
                <Trash2 />
                Delete permanently
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
