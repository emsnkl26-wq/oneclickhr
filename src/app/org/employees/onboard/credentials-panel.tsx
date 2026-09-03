'use client'

/**
 * What to hand the new employee: the door, the email that opens it, and the
 * one-time password.
 *
 * Shared by the screen that appears the moment an account is created and by the
 * dialog the wizard shows for a legacy draft, because the thing they are
 * displaying is the same thing and it must be described the same way. The
 * password is returned exactly once and stored nowhere — not in the URL, not in
 * the database — so the copy here is blunt about that rather than reassuring.
 */

import * as React from 'react'
import { Copy, Mail, MailX } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { NewCredentials } from '@/lib/new-credentials'

export function CredentialsPanel({ credentials }: { credentials: NewCredentials }) {
  const summary = [
    `Sign-in page: ${credentials.loginUrl}`,
    `Email: ${credentials.email}`,
    credentials.tempPassword ? `Temporary password: ${credentials.tempPassword}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div className="space-y-4">
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
              once you leave this screen.
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
    </div>
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
