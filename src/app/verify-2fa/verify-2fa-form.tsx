'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPost, ApiClientError } from '@/lib/fetcher'

export function Verify2faForm({ next }: { next: string }) {
  const router = useRouter()
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await apiPost('/api/org/security/2fa/verify', { code })
      toast.success('Verified')
      router.replace(next)
      router.refresh()
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Something went wrong. Please try again.'
      )
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      <FormError message={error} />
      <FormField label="Authenticator code" required>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          placeholder="123456"
          className="tabular text-center text-lg tracking-[0.4em]"
          aria-label="6-digit authenticator code"
          required
        />
      </FormField>
      <Button type="submit" className="w-full" size="lg" loading={submitting} disabled={code.length !== 6}>
        Verify and continue
      </Button>
    </form>
  )
}
