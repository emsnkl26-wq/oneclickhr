import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Settings } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { DocumentGenerator, type GeneratorEmployee } from './document-generator'
import { todayIn } from '@/lib/time'
import type { CompanyDetails, GeneratedDocumentType } from '@/types/db'

export const metadata: Metadata = { title: 'Generate document' }
export const dynamic = 'force-dynamic'

/** Columns the generator can prefill from. Never `*` — profiles is a wide row. */
const EMPLOYEE_COLUMNS =
  'id, full_name, email, phone, designation, employment_type, pay_rate, pay_type, hire_date, date_of_joining, street_address, apartment, city, state_province, zip_postal, country'

/**
 * The generator form.
 *
 * THERE IS NO EMPLOYEE PICKER, and that is the point. An offer letter is what
 * you send BEFORE the person is in the system: they receive it, they accept, and
 * only then do they onboard and get a profile. Asking "which employee is this
 * for?" put the steps in the wrong order and forced orgs to create a placeholder
 * account just to address a letter. The recipient is typed in instead.
 *
 * An employee CAN still be the starting point — the "Generate document" button
 * on someone's profile passes `?employee=`, which prefills their name, address,
 * title, salary and start date and files the finished PDF against their record.
 * That is a shortcut, not a requirement.
 *
 * EVERYTHING PREFILLED IS EDITABLE. A letter is a negotiated document, and
 * forcing someone back to Settings to fix a job title before they can send an
 * offer is how people end up keeping the templates in Word instead.
 *
 * What the org CANNOT edit here is the letterhead itself: it comes from Settings
 * so that every document a workspace issues agrees with every other one.
 */
export default async function NewLetterPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; type?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  // Only ever ONE profile is read, and only when the page was opened from an
  // employee's record. The old version loaded every employee in the workspace to
  // fill a dropdown that no longer exists.
  const employeeId = params.employee?.trim() || ''

  const [{ data: linked }, { data: tenant }] = await Promise.all([
    employeeId
      ? supabase
          .from('profiles')
          .select(EMPLOYEE_COLUMNS)
          .eq('id', employeeId)
          .eq('role', 'employee')
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('tenants')
      .select('name, logo_url, address_line1, address_line2, city, state_province, postal_code, country, registration_number, company_email, company_phone, website, signatory_name, signatory_title, signatory_phone')
      .eq('id', ctx.tenantId)
      .single(),
  ])

  const company: CompanyDetails = {
    name: tenant?.name ?? ctx.tenant.name,
    logoUrl: tenant?.logo_url ?? null,
    addressLine1: tenant?.address_line1 ?? null,
    addressLine2: tenant?.address_line2 ?? null,
    city: tenant?.city ?? null,
    stateProvince: tenant?.state_province ?? null,
    postalCode: tenant?.postal_code ?? null,
    country: tenant?.country ?? null,
    registrationNumber: tenant?.registration_number ?? null,
    companyEmail: tenant?.company_email ?? null,
    companyPhone: tenant?.company_phone ?? null,
    website: tenant?.website ?? null,
    signatoryName: tenant?.signatory_name ?? null,
    signatoryTitle: tenant?.signatory_title ?? null,
    signatoryPhone: tenant?.signatory_phone ?? null,
  }

  const types: GeneratedDocumentType[] = ['offer_letter', 'employment_agreement', 'internship_offer']
  const initialType = types.includes(params.type as GeneratedDocumentType)
    ? (params.type as GeneratedDocumentType)
    : 'offer_letter'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Generate document"
        description="Pick a template, check the details, and download a PDF on your letterhead."
        actions={
          <>
            <Button asChild variant="ghost">
              <Link href="/org/settings">
                <Settings />
                Letterhead settings
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/org/letters">
                <ArrowLeft />
                All documents
              </Link>
            </Button>
          </>
        }
      />

      <DocumentGenerator
        company={company}
        employee={(linked ?? null) as unknown as GeneratorEmployee | null}
        initialType={initialType}
        today={todayIn(ctx.tenant.timezone)}
      />
    </div>
  )
}
