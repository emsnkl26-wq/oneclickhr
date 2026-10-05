'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'
import { deriveOrgCode } from '@/lib/org-code'

export function CompleteSignupForm({ email, defaultName }: { email: string; defaultName: string }) {
  const [orgName, setOrgName] = React.useState('')
  const [orgCode, setOrgCode] = React.useState('')
  const [domain, setDomain] = React.useState(() => {
    // A company address suggests its own website; a gmail.com one does not.
    const host = email.split('@')[1]?.toLowerCase() ?? ''
    return /^(gmail|googlemail|outlook|hotmail|yahoo|icloud|live|proton(mail)?)\./.test(host) ? '' : host
  })
  const [fullName, setFullName] = React.useState(defaultName)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      const { redirectTo } = await apiPost<{ redirectTo: string }>('/api/auth/google-complete', {
        orgName,
        orgCode: orgCode.trim() || undefined,
        domain,
        fullName,
      })
      // A full load, not a client navigation: the session was refreshed on the
      // server to carry the new workspace, and every layout must read it fresh.
      window.location.assign(redirectTo)
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

  const suggestion = deriveOrgCode(orgName)

  return (
    <div className="card-surface p-7">
      <h1 className="text-[22px] font-bold tracking-[-0.02em]">Name your workspace</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Signed in with Google as <strong className="text-ink">{email}</strong>. One more step to set up
        your organization.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        <FormError message={error} />

        <FormField label="Organization name" error={fields.orgName} required>
          <Input
            autoComplete="organization"
            placeholder="Acme Health"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            required
          />
        </FormField>

        <FormField
          label="Organization code"
          error={fields.orgCode}
          hint={
            suggestion
              ? `Used for employee and invoice IDs, e.g. ${suggestion}-0001. Leave blank to use ${suggestion}.`
              : 'Used for employee and invoice IDs, e.g. NKL-0001. Optional.'
          }
        >
          <Input
            placeholder={suggestion ?? 'NKL'}
            value={orgCode}
            maxLength={6}
            onChange={(e) => setOrgCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            className="uppercase"
          />
        </FormField>

        <FormField
          label="Company website"
          error={fields.domain}
          hint="Used to keep one workspace per company. You'll confirm it later."
          required
        >
          <Input
            inputMode="url"
            placeholder="acme.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            required
          />
        </FormField>

        <FormField label="Your name" error={fields.fullName} required>
          <Input
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </FormField>

        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Create workspace
        </Button>
      </form>

      <form action="/api/auth/signout" method="post" className="mt-6 text-center">
        <button type="submit" className="text-sm text-ink-muted hover:text-ink hover:underline">
          Not you? Sign out
        </button>
      </form>
    </div>
  )
}
