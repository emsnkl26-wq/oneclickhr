'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import { TimezoneSelect } from '@/components/ui/timezone-select'

/**
 * Self-service profile edit.
 *
 * The fields here are exactly the ones `tg_profiles_guard` lets a user change on
 * their own row. Role, department, designation, employee code and `is_active`
 * are privileged — the trigger raises if any of them appear in a self-update, so
 * the form cannot offer them even by accident.
 *
 * The PHOTO is deliberately absent: it belongs to `ProfileHero`, which shows it
 * at full size and saves it on the spot. This form posts only its own three
 * fields, and the API leaves anything it does not send alone — so the two
 * controls cannot revert each other.
 */
export function ProfileForm({
  profile,
}: {
  profile: {
    fullName: string
    phone: string
    timezone: string
    linkedinUrl: string
  }
}) {
  const router = useRouter()
  const [fullName, setFullName] = React.useState(profile.fullName)
  const [phone, setPhone] = React.useState(profile.phone)
  const [timezone, setTimezone] = React.useState(profile.timezone)
  const [linkedinUrl, setLinkedinUrl] = React.useState(profile.linkedinUrl)
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      await apiPatch('/api/employee/profile', {
        fullName,
        phone: phone || null,
        timezone,
        linkedinUrl: linkedinUrl || null,
      })
      toast.success('Profile updated')
      router.refresh()
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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your details</CardTitle>
        <CardDescription>These are the parts you can change yourself.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <FormError message={error} />

          <FormField label="Full name" error={fields.fullName} required>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </FormField>

          <FormField label="Phone" error={fields.phone}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </FormField>

          <FormField label="Timezone" hint="How dates and times are displayed to you.">
            <TimezoneSelect value={timezone} onChange={setTimezone} />
          </FormField>

          <FormField
            label="LinkedIn"
            error={fields.linkedinUrl}
            hint="Shown as your contact link on any job posting you recruit for."
          >
            <Input
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/…"
            />
          </FormField>

          <Button type="submit" loading={submitting}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
