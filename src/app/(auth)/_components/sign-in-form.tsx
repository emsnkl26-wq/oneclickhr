'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError, FormSuccess } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'

export type Portal = 'org' | 'employee' | 'candidate'

interface SignInFormProps {
  /**
   * Which door this is. Sent to the server, which refuses the sign-in if the
   * account's role does not belong to this portal. It is a UX separation, not a
   * security boundary — the boundary is the role check on the server and RLS
   * underneath it — so nothing here needs to be secret.
   */
  portal: Portal
  title: string
  subtitle: string
  footer?: React.ReactNode
}

export function SignInForm({ portal, title, subtitle, footer }: SignInFormProps) {
  const router = useRouter()
  const params = useSearchParams()

  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  // Messages arrive from /auth/confirm and the reset flow as query params.
  const notice = params.get('message')
  const linkError = params.get('error')

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    try {
      const { redirectTo } = await apiPost<{ redirectTo: string }>('/api/auth/login', {
        email,
        password,
        portal,
      })
      const next = params.get('next')
      // Only honour a same-origin relative path — an open redirect here would
      // let a phishing link bounce through our own login page.
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : redirectTo
      router.replace(target)
      router.refresh()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message)
        setFields(err.fields ?? {})
      } else {
        setError('Something went wrong. Please try again.')
      }
      setSubmitting(false)
    }
  }

  return (
    <div className="card-surface p-7">
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">{title}</h1>
      <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {notice ? <FormSuccess message={notice} /> : null}
        <FormError message={error ?? linkError} />

        <FormField label={portal === 'candidate' ? 'Email' : 'Work email'} error={fields.email} required>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            placeholder={portal === 'candidate' ? 'you@example.com' : 'you@company.com'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Password" error={fields.password} required>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-muted hover:text-ink"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-[13px] font-medium text-brand-600 hover:text-brand-700 hover:underline"
          >
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Sign in
        </Button>
      </form>

      {footer}
    </div>
  )
}
