import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { SettingsTabs } from './settings-tabs'
import { getStorageUsage } from '@/lib/storage-quota'
import type { StorageRequestRow } from './storage-card'
import type { OrgFileRow } from './org-files-tab'
import type { CompanyDetails } from '@/types/db'

export const metadata: Metadata = { title: 'Settings' }
export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const [{ data: departments }, { data: tenant }, storage, { data: storageRequests }, { data: orgFiles }] = await Promise.all([
    supabase.from('departments').select('id, name').order('name'),
    supabase
      .from('tenants')
      .select('org_code, default_currency, address_line1, address_line2, city, state_province, postal_code, country, registration_number, company_email, company_phone, website, signatory_name, signatory_title, signatory_phone, invoice_payment_details, overtime_weekly_threshold, company_linkedin_url, two_factor_window_hours')
      .eq('id', ctx.tenantId)
      .single(),
    getStorageUsage(ctx.tenantId),
    supabase
      .from('storage_requests')
      .select('id, requested_bytes, reason, status, granted_bytes, admin_note, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    // The org's shared files (013): general documents with no employee attached.
    supabase
      .from('documents')
      .select('id, file_url, file_name, label, mime_type, size_bytes, created_at')
      .eq('kind', 'general')
      .is('employee_id', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  const company: CompanyDetails = {
    name: ctx.tenant.name,
    logoUrl: ctx.tenant.logoUrl,
    orgCode: tenant?.org_code ?? null,
    defaultCurrency: tenant?.default_currency ?? 'USD',
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
    invoicePaymentDetails: tenant?.invoice_payment_details ?? null,
    companyLinkedinUrl: tenant?.company_linkedin_url ?? null,
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your workspace, company details, security and integrations."
      />

      <SettingsTabs
        ctx={{
          email: ctx.email,
          userId: ctx.userId,
          fullName: ctx.fullName,
          isOwner: ctx.isOwner,
          twoFactorEnabled: ctx.twoFactorEnabled,
          tenant: {
            name: ctx.tenant.name,
            primaryColor: ctx.tenant.primaryColor,
            timezone: ctx.tenant.timezone,
            workStartTime: ctx.tenant.workStartTime,
            defaultTrackingMode: ctx.tenant.defaultTrackingMode,
            logoUrl: ctx.tenant.logoUrl,
            domain: ctx.tenant.domain,
            domainVerified: ctx.tenant.domainVerified,
            defaultCurrency: ctx.tenant.defaultCurrency,
          },
        }}
        tenant={{
          org_code: tenant?.org_code ?? null,
          two_factor_window_hours:
            tenant?.two_factor_window_hours == null ? null : Number(tenant.two_factor_window_hours),
          overtime_weekly_threshold:
            tenant?.overtime_weekly_threshold == null ? null : Number(tenant.overtime_weekly_threshold),
        }}
        departments={departments ?? []}
        company={company}
        storage={storage}
        storageRequests={((storageRequests ?? []) as StorageRequestRow[]).map((r) => ({
          ...r,
          requested_bytes: Number(r.requested_bytes),
          granted_bytes: r.granted_bytes == null ? null : Number(r.granted_bytes),
        }))}
        files={(
          (orgFiles ?? []) as Array<{
            id: string
            file_url: string
            file_name: string | null
            label: string | null
            mime_type: string | null
            size_bytes: number | null
            created_at: string
          }>
        ).map((f): OrgFileRow => ({
          id: f.id,
          fileUrl: f.file_url,
          fileName: f.file_name,
          label: f.label,
          mimeType: f.mime_type,
          sizeBytes: f.size_bytes == null ? null : Number(f.size_bytes),
          createdAt: f.created_at,
        }))}
      />
    </div>
  )
}
