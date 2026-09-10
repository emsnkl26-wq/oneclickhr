import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { PlacementsWorkspace } from './placements-workspace'

export const metadata: Metadata = { title: 'Placements' }
export const dynamic = 'force-dynamic'

/**
 * Vendors, end clients, and who is placed where.
 *
 * ONE PAGE FOR THREE TABLES because they are one job. Setting up a placement
 * needs the vendor to exist and usually the client too, and splitting them
 * across three nav entries meant three round trips to record one fact.
 *
 * Everything here is org-only, enforced by RLS on all three tables — this page
 * reads `bill_rate`, which is the number 022 exists to keep away from
 * employees. `requireOrg()` is the gate; the policies are the guarantee.
 */
export default async function PlacementsPage({
  searchParams,
}: {
  searchParams: Promise<{ employee?: string; tab?: string }>
}) {
  await requireOrg()
  const params = await searchParams
  const supabase = await createSupabaseServerClient()

  const [{ data: placements }, { data: vendors }, { data: clients }, { data: employees }] =
    await Promise.all([
      supabase
        .from('employee_assignments')
        .select(
          'id, employee_id, vendor_id, client_id, bill_rate, bill_currency, pay_rate, pay_currency, ' +
            'rate_unit, start_date, end_date, is_primary, status, notes, ' +
            'employee:profiles!employee_assignments_employee_fk(id, full_name, email), ' +
            'vendor:vendors(id, name), client:clients(id, name)'
        )
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('vendors')
        .select('id, name, contact_name, email, phone, address, payment_terms_days, notes, status')
        .order('name'),
      supabase
        .from('clients')
        .select('id, name, contact_name, email, address, notes, status')
        .order('name'),
      supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('role', 'employee')
        .eq('is_active', true)
        .order('full_name'),
    ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Placements"
        description="Who each person works through, who they work for, and at what rates."
      />
      <PlacementsWorkspace
        placements={(placements ?? []) as never}
        vendors={(vendors ?? []) as never}
        clients={(clients ?? []) as never}
        employees={(employees ?? []) as never}
        initialEmployeeId={params.employee ?? ''}
        initialTab={params.tab === 'vendors' || params.tab === 'clients' ? params.tab : 'placements'}
      />
    </div>
  )
}
