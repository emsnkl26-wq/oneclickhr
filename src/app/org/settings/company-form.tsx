'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { FormField, FormError } from '@/components/ui/form-field'
import { apiPatch, ApiClientError } from '@/lib/fetcher'
import {
  COUNTRY_CODES, countryCodeOf, countryName, divisionLabel, divisionsFor,
} from '@/lib/geo'
import type { CompanyDetails } from '@/types/db'

/** Sentinel for "my country isn't on the list" — keeps the free-text box reachable. */
const OTHER = '__other'

/**
 * The currencies these workspaces actually bill and spend in. A static list for
 * the same reason src/lib/geo.ts keeps one: the alternative is a service to
 * key, rate limit, and be down while somebody is fixing their settings.
 */
const CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'NZD', 'AED', 'SGD', 'ZAR',
  'JPY', 'CHF', 'SEK', 'MXN', 'BRL', 'PHP',
] as const

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
    orgCode: company.orgCode ?? '',
    defaultCurrency: company.defaultCurrency ?? 'USD',
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

  /*
   * The dropdown works in ISO-2 codes; the COLUMN keeps the printed name, since
   * that string goes on a letterhead. A stored country we don't have a list for
   * (or a hand-typed one from before this was a dropdown) resolves to OTHER, so
   * nobody's saved value is silently dropped the first time they open the form.
   */
  const [countryCode, setCountryCode] = React.useState(() => {
    const resolved = countryCodeOf(company.country)
    if (resolved) return resolved
    return company.country?.trim() ? OTHER : ''
  })

  const divisions = divisionsFor(countryCode)

  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }))

  function onCountryChange(event: { target: { value: string } }) {
    const next = event.target.value
    setCountryCode(next)
    setValues((current) => ({
      ...current,
      country: next === OTHER || next === '' ? '' : countryName(next),
      // The old division belongs to the old country's list. Keeping "Maryland"
      // under Canada would save a state that country does not have.
      stateProvince: '',
    }))
  }

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
              <FormField label="Country" error={fields.country}>
                <Select value={countryCode} onChange={onCountryChange} placeholder="Select a country">
                  <option value="">Not set</option>
                  {COUNTRY_CODES.map((code) => (
                    <option key={code} value={code}>
                      {countryName(code)}
                    </option>
                  ))}
                  <option value={OTHER}>Somewhere else…</option>
                </Select>
                {countryCode === OTHER ? (
                  <Input
                    className="mt-2"
                    value={values.country}
                    onChange={set('country')}
                    placeholder="Country"
                    aria-label="Country"
                  />
                ) : null}
              </FormField>

              <FormField
                label={divisionLabel(countryCode)}
                error={fields.stateProvince}
                hint={
                  countryCode === '' ? 'Pick a country first to choose from a list.' : undefined
                }
              >
                {divisions.length > 0 ? (
                  <Select
                    value={values.stateProvince}
                    onChange={set('stateProvince')}
                    placeholder={`Select a ${divisionLabel(countryCode).toLowerCase()}`}
                  >
                    <option value="">Not set</option>
                    {divisions.map((division) => (
                      <option key={division} value={division}>
                        {division}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    value={values.stateProvince}
                    onChange={set('stateProvince')}
                    placeholder="Maryland"
                  />
                )}
              </FormField>

              <FormField label="City" error={fields.city}>
                <Input value={values.city} onChange={set('city')} placeholder="Ellicott City" />
              </FormField>
              <FormField label="ZIP / postal code" error={fields.postalCode}>
                <Input value={values.postalCode} onChange={set('postalCode')} placeholder="21043" />
              </FormField>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Registration and contact
            </p>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/*
                Editable, but only forward-looking: it changes what the NEXT
                employee ID and invoice number look like. Renumbering the codes
                already printed on offer letters and sent invoices is not
                something a settings field should be able to do by accident.
              */}
              <FormField
                label="Organization code"
                error={fields.orgCode}
                hint="Prefixes new employee IDs and invoice numbers. Existing ones keep theirs."
              >
                <Input
                  value={values.orgCode}
                  onChange={(e) =>
                    setValues((current) => ({
                      ...current,
                      orgCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''),
                    }))
                  }
                  maxLength={6}
                  placeholder="NKL"
                  className="uppercase"
                />
              </FormField>
              <FormField
                label="Currency"
                error={fields.defaultCurrency}
                hint="What expenses, invoices and the profit figure are reported in."
              >
                <Select
                  value={values.defaultCurrency}
                  onChange={set('defaultCurrency')}
                  options={CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
                />
              </FormField>
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
