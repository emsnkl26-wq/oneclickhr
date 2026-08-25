'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Copy, KeyRound, RefreshCw } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { cn } from '@/lib/utils'
import { takeCredentials } from '@/lib/new-credentials'

interface IssuedCredentials {
  email: string
  tempPassword: string | null
  emailSent: boolean
  loginUrl: string
}

/**
 * What the org needs in order to hand an account over: the employee sign-in
 * URL, the email that works there, and — on request — a password.
 *
 * The password issued at onboarding is deliberately unrecoverable (only its
 * hash is stored), so this card cannot re-display it. Instead it mints a fresh
 * one, which is the same act from the employee's side: sign in, then choose
 * their own.
 */
export function SignInDetails({
  employeeId, email, loginUrl, mustChangePassword,
}: {
  employeeId: string
  email: string
  loginUrl: string
  mustChangePassword: boolean
}) {
  const router = useRouter()
  const [issued, setIssued] = React.useState<IssuedCredentials | null>(null)
  const [working, setWorking] = React.useState(false)

  /*
   * Onboarding finishes on another route and lands here, so the password it
   * just created arrives through a one-shot sessionStorage hand-off rather
   * than being flashed on a page the wizard is already navigating away from.
   */
  React.useEffect(() => {
    const handed = takeCredentials(employeeId)
    if (handed?.tempPassword) setIssued(handed as IssuedCredentials)
  }, [employeeId])

  async function issue() {
    setWorking(true)
    try {
      const result = await apiPost<IssuedCredentials>(
        `/api/org/employees/${employeeId}/credentials`
      )
      setIssued(result)
      toast.success(
        result.emailSent ? 'New password created and emailed' : 'New password created'
      )
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof ApiClientError ? err.message : 'Could not create a new password.'
      )
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-ink-muted">
          Share these with {email} so they can reach the employee portal. This is the
          employee door — the administrator sign-in you use will refuse these details.
        </p>

        <div className="space-y-3 rounded-xl border border-line bg-page p-4">
          <Detail label="Sign-in page" value={loginUrl} copyable mono />
          <Detail label="Email" value={email} copyable />
          {issued?.tempPassword ? (
            <Detail label="Temporary password" value={issued.tempPassword} copyable mono />
          ) : (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                Password
              </p>
              <p className="mt-1 text-sm text-ink-muted">
                {mustChangePassword
                  ? 'Shown only when it is created. Issue a new one below if it was not saved.'
                  : 'They have chosen their own password.'}
              </p>
            </div>
          )}
        </div>

        {issued?.tempPassword ? (
          <p className="text-xs leading-relaxed text-ink-muted">
            Copy it now — it is stored nowhere and cannot be shown again.
            {issued.emailSent ? ' A copy has also been emailed to them.' : ''} They will be
            asked to choose their own password the first time they sign in.
          </p>
        ) : null}

        <Button variant="secondary" onClick={issue} loading={working} className="w-full">
          {issued?.tempPassword ? <RefreshCw /> : <KeyRound />}
          {issued?.tempPassword ? 'Issue another password' : 'Issue a new password'}
        </Button>

        {!issued?.tempPassword && !mustChangePassword ? (
          <p className="text-xs text-ink-muted">
            Issuing a new password replaces the one they chose and signs them out.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Detail({
  label, value, copyable, mono,
}: {
  label: string
  value: string
  copyable?: boolean
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <span
          className={cn(
            'flex-1 break-all text-sm font-medium',
            mono && 'rounded-lg border border-line bg-card px-3 py-2 font-mono'
          )}
        >
          {value}
        </span>
        {copyable ? (
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
        ) : null}
      </div>
    </div>
  )
}
