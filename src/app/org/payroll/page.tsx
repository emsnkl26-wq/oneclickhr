import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { PayrollReview, type ConfirmationRow, type EmployeeRow } from './payroll-review'

export const metadata: Metadata = { title: 'Payroll' }
export const dynamic = 'force-dynamic'

/**
 * Payroll, from the organization's side — now a REVIEW screen, not an upload one.
 *
 * Payroll itself runs in ADP: the money reaches each employee automatically on
 * payday, and this product is not in that path. What it is good for is the part
 * ADP cannot answer — did every person actually receive it, and can we show that
 * they said so? So the employee uploads the confirmation (026) and this screen
 * is where it gets checked.
 *
 * The org's own payslip upload is gone. Payslips already uploaded remain
 * readable by the employees they belong to; see `/employee/payroll`.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>
}) {
  await requireOrg()
  const supabase = await createSupabaseServerClient()

  const params = await searchParams
  const now = new Date()
  const month = Math.min(12, Math.max(1, parseInt(params.month ?? '', 10) || now.getMonth() + 1))
  const year = Math.min(2200, Math.max(2000, parseInt(params.year ?? '', 10) || now.getFullYear()))

  const [{ data: employees }, { data: confirmations }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url, employee_code, designation')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('payment_confirmations')
      .select(
        'id, employee_id, month, year, amount, currency, paid_on, file_url, file_name, note, status, review_note, verified_at'
      )
      .eq('month', month)
      .eq('year', year),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Salaries are paid by your payroll provider. This is where employees confirm they received them."
      />
      <PayrollReview
        employees={(employees ?? []) as unknown as EmployeeRow[]}
        confirmations={(confirmations ?? []) as unknown as ConfirmationRow[]}
        month={month}
        year={year}
      />
    </div>
  )
}
