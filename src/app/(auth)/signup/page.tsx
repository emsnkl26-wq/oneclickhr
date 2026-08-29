'use client'

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, Eye, EyeOff, MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'

export default function SignupPage() {
  const [orgName, setOrgName] = React.useState('')
  const [domain, setDomain] = React.useState('')
  const [fullName, setFullName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)
  const [sent, setSent] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)

    try {
      await apiPost('/api/auth/signup', { orgName, domain, fullName, email, password })
      setSent(true)
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

  if (sent) {
    return (
      <div className="card-surface p-8 text-center">
        <span className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <MailCheck className="size-6" aria-hidden />
        </span>
        <h1 className="text-[22px] font-bold tracking-[-0.02em]">Check your inbox</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          We sent a confirmation link to <strong className="text-ink">{email}</strong>. Open it to
          activate your workspace.
        </p>
        <p className="mt-4 rounded-lg bg-page px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
          The link works on <strong className="text-ink">any device</strong> — open it on your phone
          if that is where your email is, then come back here to sign in.
        </p>
        <Button asChild variant="secondary" className="mt-6 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    )
  }

  const passwordRules = [
    { label: 'At least 10 characters', met: password.length >= 10 },
    { label: 'Contains a letter', met: /[a-zA-Z]/.test(password) },
    { label: 'Contains a number', met: /[0-9]/.test(password) },
  ]

  return (
    <div className="card-surface p-7">
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">Create your workspace</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Set up your organization in under a minute.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormError message={error} />

        <FormField label="Organization name" error={fields.orgName} required>
          <Input
            name="orgName"
            autoComplete="organization"
            placeholder="Acme Health"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
          />
        </FormField>

        {/*
          Asked here and nowhere else, because this is the only moment where the
          answer can PREVENT a duplicate workspace rather than have to merge one
          later. Nothing is verified yet — that is a banner on the dashboard
          afterwards, so signup stays four fields and under a minute.
        */}
        <FormField
          label="Company website"
          error={fields.domain}
          hint="Used to keep one workspace per company. You'll confirm it later."
          required
        >
          <Input
            name="domain"
            autoComplete="url"
            inputMode="url"
            placeholder="acme.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Your name" error={fields.fullName} required>
          <Input
            name="fullName"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Work email" error={fields.email} required>
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

        <FormField label="Password" error={fields.password} required>
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="new-password"
              placeholder="Choose a strong password"
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

        {password ? (
          <ul className="space-y-1.5 rounded-lg bg-page px-3.5 py-3">
            {passwordRules.map((rule) => (
              <li
                key={rule.label}
                className={`flex items-center gap-2 text-xs ${
                  rule.met ? 'text-emerald-700' : 'text-ink-muted'
                }`}
              >
                <CheckCircle2
                  className={`size-3.5 ${rule.met ? 'opacity-100' : 'opacity-35'}`}
                  aria-hidden
                />
                {rule.label}
              </li>
            ))}
          </ul>
        ) : null}

        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Create workspace
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
