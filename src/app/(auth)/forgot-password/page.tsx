'use client'

import * as React from 'react'
import Link from 'next/link'
import { MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [sent, setSent] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/auth/forgot-password', { email })
      setSent(true)
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (sent) {
    return (
      <div className="card-surface p-8 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Check your inbox</h1>
        {/* Deliberately does not confirm whether the address exists. */}
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          If <strong className="text-ink">{email}</strong> has an account, a reset link is on its
          way. It works on any device.
        </p>
        <Button asChild variant="secondary" className="mt-6 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="card-surface p-7">
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">Reset your password</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Enter your work email and we will send you a link.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormError message={error} />
        <FormField label="Work email" required>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </FormField>
        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Send reset link
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
