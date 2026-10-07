import 'server-only'

/**
 * What the job dialog prefills from the workspace (056): the people it can name
 * as the recruiter contact, and the company LinkedIn page from Settings.
 *
 * Read through the user-scoped client. Both the org and a recruiter can read
 * their own tenant row and the staff directory, so neither needs the service
 * role for this.
 */
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { RecruiterOption } from '@/app/org/jobs/job-dialog'

export async function loadJobDialogExtras(tenantId: string): Promise<{
  recruiters: RecruiterOption[]
  companyLinkedinUrl: string | null
}> {
  const supabase = await createSupabaseServerClient()
  const [{ data: people }, { data: tenant }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, phone, designation')
      .eq('tenant_id', tenantId)
      .eq('role', 'employee')
      .eq('is_active', true)
      .eq('is_recruiter', true)
      .order('full_name'),
    supabase.from('tenants').select('company_linkedin_url').eq('id', tenantId).maybeSingle(),
  ])

  const recruiters = ((people ?? []) as Array<{
    id: string
    full_name: string | null
    email: string | null
    phone: string | null
    designation: string | null
  }>).map((p) => ({
    id: p.id,
    name: p.full_name || p.email || 'Recruiter',
    title: p.designation,
    email: p.email,
    phone: p.phone,
  }))

  return {
    recruiters,
    companyLinkedinUrl:
      (tenant as { company_linkedin_url: string | null } | null)?.company_linkedin_url ?? null,
  }
}
