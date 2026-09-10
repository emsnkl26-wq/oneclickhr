'use client'

/**
 * The administrators of a workspace, and the two things an owner can do to it.
 *
 * OWNER VERSUS ADMIN. Everybody in this list has identical access to /org —
 * every page, every action. The owner alone can invite and revoke, because
 * those are the two powers that could be used to remove the owner. The
 * distinction is enforced by `apiRequireOwner()` on the server; this component
 * only decides whether to draw the buttons.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Crown, ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { FormField, FormError } from '@/components/ui/form-field'
import { StatusChip } from '@/components/ui/patterns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/primitives'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogBody, DialogFooter,
} from '@/components/ui/primitives'
import { apiPost, apiDelete, ApiClientError } from '@/lib/fetcher'
import { CredentialsPanel } from '@/app/org/employees/onboard/credentials-panel'
import type { NewCredentials } from '@/lib/new-credentials'
import { initials } from '@/lib/utils'

export interface AdminRow {
  id: string
  full_name: string | null
  email: string | null
  photo_url: string | null
  is_active: boolean
  is_owner: boolean
  created_at: string
}

export function AdminList({
  admins, currentUserId, isOwner,
}: {
  admins: AdminRow[]
  currentUserId: string
  isOwner: boolean
}) {
  const router = useRouter()
  const [inviting, setInviting] = React.useState(false)
  const [revoking, setRevoking] = React.useState<AdminRow | null>(null)
  const [busy, setBusy] = React.useState(false)

  async function revoke() {
    if (!revoking) return
    setBusy(true)
    try {
      await apiDelete(`/api/org/admins/${revoking.id}`)
      toast.success('Access revoked')
      setRevoking(null)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {isOwner ? (
        <div className="flex justify-end">
          <Button onClick={() => setInviting(true)}>
            <UserPlus />
            Invite administrator
          </Button>
        </div>
      ) : (
        <p className="rounded-lg border border-line bg-page px-4 py-3 text-[13px] text-ink-muted">
          You have full access to this workspace. Inviting and revoking other administrators is the
          owner&rsquo;s to do.
        </p>
      )}

      <ul className="space-y-2.5">
        {admins.map((person) => (
          <li key={person.id}>
            <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <Avatar className="size-9 shrink-0">
                {person.photo_url ? (
                  <AvatarImage
                    src={`/api/files/view?key=${encodeURIComponent(person.photo_url)}`}
                    alt=""
                  />
                ) : null}
                <AvatarFallback>{initials(person.full_name, person.email)}</AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-medium">
                    {person.full_name || person.email}
                    {person.id === currentUserId ? (
                      <span className="ml-1.5 text-[13px] font-normal text-ink-muted">(you)</span>
                    ) : null}
                  </p>
                  {person.is_owner ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      <Crown className="size-3" aria-hidden />
                      Owner
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      <ShieldCheck className="size-3" aria-hidden />
                      Admin
                    </span>
                  )}
                  {!person.is_active ? <StatusChip status="inactive" label="Revoked" /> : null}
                </div>
                <p className="truncate text-[13px] text-ink-muted">{person.email}</p>
              </div>

              {isOwner && !person.is_owner && person.is_active ? (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Revoke ${person.full_name || person.email}`}
                  onClick={() => setRevoking(person)}
                >
                  <Trash2 />
                </Button>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} />

      <Dialog open={!!revoking} onOpenChange={(open) => !open && setRevoking(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Revoke {revoking?.full_name || revoking?.email}?</DialogTitle>
          </DialogHeader>
          <DialogBody className="pb-4">
            <p className="text-sm text-ink-muted">
              Their access ends on their next request, not whenever their session expires. The
              account is kept, because their name is on approvals and documents — nothing they
              did is removed.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRevoking(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={revoke}>
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Inviting one.
 *
 * The temporary password comes back ONCE and is stored nowhere, so — exactly as
 * with the employee invite — the dialog switches to a result state rather than
 * closing. Navigating away is what destroys it, so nothing here navigates.
 */
function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [fullName, setFullName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [sendEmail, setSendEmail] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<NewCredentials | null>(null)

  React.useEffect(() => {
    if (open) return
    // Reset only on CLOSE, so the credentials survive as long as the dialog does.
    setFullName('')
    setEmail('')
    setSendEmail(true)
    setError(null)
    setFields({})
    setResult(null)
  }, [open])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setBusy(true)
    try {
      const created = await apiPost<NewCredentials>('/api/org/admins', {
        fullName,
        email,
        sendCredentialsEmail: sendEmail,
      })
      setResult(created)
      router.refresh()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Administrator added</DialogTitle>
              <DialogDescription>
                They sign in at the administrator door and will be asked to change this password.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <CredentialsPanel credentials={result} />
            </DialogBody>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Invite an administrator</DialogTitle>
              <DialogDescription>
                They get the same access to this workspace as you, except for inviting and revoking
                administrators and changing the company website.
              </DialogDescription>
            </DialogHeader>

            <DialogBody className="space-y-4">
              <FormError message={error} />

              <FormField label="Full name" error={fields.fullName} required>
                <Input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                  autoFocus
                />
              </FormField>

              <FormField
                label="Email address"
                error={fields.email}
                required
                hint="This becomes their sign-in. It cannot be changed later."
              >
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </FormField>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-page px-3.5 py-3">
                <Checkbox
                  checked={sendEmail}
                  onChange={(event) => setSendEmail(event.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-[13px] leading-relaxed">
                  <span className="font-medium text-ink">Email them their sign-in details</span>
                  <span className="mt-0.5 block text-ink-muted">
                    Leave this off and you can copy the details on the next screen instead.
                  </span>
                </span>
              </label>
            </DialogBody>

            <DialogFooter>
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                <UserPlus />
                Invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
