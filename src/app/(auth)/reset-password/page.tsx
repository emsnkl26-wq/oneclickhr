'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'

/**
 * Reached only after `/auth/confirm?type=recovery` verified the emailed token on
 * the server and left a short-lived session on THIS device. No current password
 * is asked for — proving control of the mailbox is the proof.
 */
export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  // Which sign-in page to offer afterwards. The server decides it from the role
  // it can still see, and falls back to the admin door if anything is unclear.
  const [signInPath, setSignInPath] = React.useState('/login')
  const [done, setDone] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      const result = await apiPost<{ signInPath?: string }>('/api/auth/reset-password', {
        password,
        confirmPassword,
      })
      if (result?.signInPath?.startsWith('/')) setSignInPath(result.signInPath)
      setDone(true)
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="card-surface p-8 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Password updated</h1>
        <p className="mt-2 text-sm text-ink-muted">Sign in with your new password to continue.</p>
        <Button className="mt-6 w-full" size="lg" onClick={() => router.replace(signInPath)}>
          Go to sign in
        </Button>
      </div>
    )
  }

  return (
    <div className="card-surface p-7">
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Make it at least 10 characters, with a letter and a number.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormError message={error} />

        <FormField label="New password" error={fields.password} required>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Confirm new password" error={fields.confirmPassword} required>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </FormField>

        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Update password
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-brand-ink hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
