import type { Metadata } from 'next'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader } from '@/components/ui/patterns'
import { EnquiriesList, type EnquiryRow } from './enquiries-list'

export const metadata: Metadata = { title: 'Enquiries' }
export const dynamic = 'force-dynamic'

/**
 * Contact-form enquiries from the marketing site (065).
 *
 * Platform-level and read cross-tenant like everything else in this console:
 * `requireSuperAdmin()` gates the page and the service-role client reads the
 * table, which carries no tenant and is invisible to `authenticated`.
 */
export default async function EnquiriesPage() {
  await requireSuperAdmin()
  const admin = createAdminClient()

  const { data } = await admin
    .from('contact_enquiries')
    .select('id, name, email, company, team_size, enquiry, message, status, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  const rows: EnquiryRow[] = (
    (data ?? []) as Array<{
      id: string
      name: string
      email: string
      company: string
      team_size: string | null
      enquiry: string | null
      message: string
      status: string
      created_at: string
    }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    company: r.company,
    teamSize: r.team_size,
    enquiry: r.enquiry,
    message: r.message,
    status: (r.status === 'read' || r.status === 'archived' ? r.status : 'new') as EnquiryRow['status'],
    createdAt: r.created_at,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Enquiries"
        description="Messages from the oneclickhr.app contact form."
      />
      <EnquiriesList initialRows={rows} />
    </div>
  )
}
