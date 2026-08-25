'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import type { CompanyDetails } from '@/types/db'

/**
 * The company details a generated document prints on its letterhead.
 *
 * Separate from the branding form beside it, and posting to the same endpoint:
 * `/api/org/settings` treats an absent key as "leave it alone", so the two forms
 * write different columns of the same row without either reverting the other.
 *
 * Everything here is OPTIONAL. A document omits a line the org has not filled
 * in rather than printing a placeholder — a letterhead with a blank labelled
 * "EIN" on a real employment offer is worse than one without the line at all.
 */
export function CompanyForm({ company }: { company: CompanyDetails }) {
  const router = useRouter()
  const [values, setValues] = React.useState({
    addressLine1: company.addressLine1 ?? '',
    addressLine2: company.addressLine2 ?? '',
    city: company.city ?? '',
    stateProvince: company.stateProvince ?? '',
    postalCode: company.postalCode ?? '',
    country: company.country ?? '',
    registrationNumber: company.registrationNumber ?? '',
    companyEmail: company.companyEmail ?? '',
    companyPhone: company.companyPhone ?? '',
    website: company.website ?? '',
    signatoryName: company.signatoryName ?? '',
    signatoryTitle: company.signatoryTitle ?? '',
    signatoryPhone: company.signatoryPhone ?? '',
  })
  const [error, setError] = React.useState<string | null>(null)
  const [fields, setFields] = React.useState<Record<string, string>>({})
  const [submitting, setSubmitting] = React.useState(false)

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setFields({})
    setSubmitting(true)
    try {
      await apiPatch('/api/org/settings', values)
      toast.success('Company details saved')
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
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4 text-ink-muted" aria-hidden />
          Company details
        </CardTitle>
        <CardDescription>
          Printed on the letterhead of every offer letter and agreement you generate. Anything you
          leave blank is simply left off the page.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <FormError message={error} />

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Address</p>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Street address" error={fields.addressLine1}>
                <Input
                  value={values.addressLine1}
                  onChange={set('addressLine1')}
                  placeholder="8795 Stonehouse Dr"
                />
              </FormField>
              <FormField label="Suite / floor" error={fields.addressLine2}>
                <Input
                  value={values.addressLine2}
                  onChange={set('addressLine2')}
                  placeholder="Suite 200"
                />
              </FormField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField label="City" error={fields.city}>
                <Input value={values.city} onChange={set('city')} placeholder="Ellicott City" />
              </FormField>
              <FormField label="State / province" error={fields.stateProvince}>
                <Input
                  value={values.stateProvince}
                  onChange={set('stateProvince')}
                  placeholder="MD"
                />
              </FormField>
              <FormField label="ZIP / postal code" error={fields.postalCode}>
                <Input value={values.postalCode} onChange={set('postalCode')} placeholder="21043" />
              </FormField>
              <FormField label="Country" error={fields.country}>
                <Input value={values.country} onChange={set('country')} placeholder="United States" />
              </FormField>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Registration and contact
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField
                label="Registration number"
                error={fields.registrationNumber}
                hint="EIN, CIN or company number."
              >
                <Input
                  value={values.registrationNumber}
                  onChange={set('registrationNumber')}
                  placeholder="33-4788802"
                />
              </FormField>
              <FormField label="Company email" error={fields.companyEmail}>
                <Input
                  type="email"
                  value={values.companyEmail}
                  onChange={set('companyEmail')}
                  placeholder="contact@example.com"
                />
              </FormField>
              <FormField label="Company phone" error={fields.companyPhone}>
                <Input
                  value={values.companyPhone}
                  onChange={set('companyPhone')}
                  placeholder="+1 (314) 548-9101"
                />
              </FormField>
              <FormField label="Website" error={fields.website}>
                <Input
                  value={values.website}
                  onChange={set('website')}
                  placeholder="www.example.com"
                />
              </FormField>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Default signatory
            </p>
            <p className="-mt-2 text-xs text-ink-muted">
              Prefilled into the signature block when you generate a document. You can change it
              per document.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Name" error={fields.signatoryName}>
                <Input
                  value={values.signatoryName}
                  onChange={set('signatoryName')}
                  placeholder="Alex Morgan"
                />
              </FormField>
              <FormField label="Title" error={fields.signatoryTitle}>
                <Input
                  value={values.signatoryTitle}
                  onChange={set('signatoryTitle')}
                  placeholder="Managing Director"
                />
              </FormField>
              <FormField label="Phone" error={fields.signatoryPhone}>
                <Input
                  value={values.signatoryPhone}
                  onChange={set('signatoryPhone')}
                  placeholder="+1 (484) 803-2090"
                />
              </FormField>
            </div>
          </div>

          <Button type="submit" loading={submitting}>
            Save company details
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
