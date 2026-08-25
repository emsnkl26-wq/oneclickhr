import type { Metadata } from 'next'
import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { SettingsForm } from './settings-form'
import { CompanyForm } from './company-form'
import { DepartmentManager } from './department-manager'
import type { CompanyDetails } from '@/types/db'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const [{ data: departments }, { data: tenant }] = await Promise.all([
    supabase.from('departments').select('id, name').order('name'),
    // The letterhead fields are not in the session context — that RPC carries
    // only what every page needs, and these are read on this one screen.
    supabase
      .from('tenants')
      .select('address_line1, address_line2, city, state_province, postal_code, country, registration_number, company_email, company_phone, website, signatory_name, signatory_title, signatory_phone')
      .eq('id', ctx.tenantId)
      .single(),
  ])

  const company: CompanyDetails = {
    name: ctx.tenant.name,
    logoUrl: ctx.tenant.logoUrl,
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Branding, working hours, departments and the details your documents are issued on."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <SettingsForm
          tenant={{
            name: ctx.tenant.name,
            primaryColor: ctx.tenant.primaryColor,
            timezone: ctx.tenant.timezone,
            workStartTime: ctx.tenant.workStartTime,
            logoUrl: ctx.tenant.logoUrl,
          }}
        />

        <div className="space-y-5">
          <DepartmentManager departments={departments ?? []} />

          <Card>
            <CardHeader>
              <CardTitle>Integrations</CardTitle>
              <CardDescription>Connect Google Calendar for two-way meeting sync.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="secondary">
                <Link href="/org/settings/integrations">
                  <CalendarDays />
                  Manage integrations
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <CompanyForm company={company} />
    </div>
  )
}
