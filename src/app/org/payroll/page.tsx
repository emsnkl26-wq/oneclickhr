import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import {
  PayrollReview, type ConfirmationRow, type EmployeeRow, type PayslipCompany, type PayslipRow,
} from './payroll-review'
import { effectivePaySchedule } from '@/lib/pay-schedule'

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
 * The org can also GENERATE each person's monthly payslip here, in the
 * organisation's own salary-slip layout; employees read it on `/employee/payroll`.
 */
export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; year?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  const params = await searchParams
  const now = new Date()
  const month = Math.min(12, Math.max(1, parseInt(params.month ?? '', 10) || now.getMonth() + 1))
  const year = Math.min(2200, Math.max(2000, parseInt(params.year ?? '', 10) || now.getFullYear()))

  const [{ data: employees }, { data: confirmations }, { data: payslips }, { data: tenant }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, full_name, email, photo_url, employee_code, designation, pay_schedule, pay_frequency, country, pay_rate, pay_currency'
      )
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('payment_confirmations')
      .select(
        'id, employee_id, month, year, period, amount, currency, paid_on, file_url, file_name, note, status, review_note, verified_at'
      )
      .eq('month', month)
      .eq('year', year),
    supabase
      .from('payslips')
      .select('id, employee_id, file_url, file_name')
      .eq('month', month)
      .eq('year', year),
    supabase
      .from('tenants')
      .select('name, logo_url, address_line1, address_line2, city, state_province, postal_code, company_email, website')
      .eq('id', ctx.tenantId)
      .single(),
  ])

  // The payslip footer's one address line: "8795 Stonehouse Dr, Ellicott City, MD – 21043".
  const region = [tenant?.state_province, tenant?.postal_code].filter(Boolean).join(' – ')
  const company: PayslipCompany = {
    name: tenant?.name ?? ctx.tenant.name,
    logoUrl: tenant?.logo_url ?? null,
    address: [tenant?.address_line1, tenant?.address_line2, tenant?.city, region]
      .filter(Boolean)
      .join(', '),
    email: tenant?.company_email ?? null,
    website: tenant?.website ?? null,
  }

  // Each person's schedule decides whether the month is one row or two (050).
  const people: EmployeeRow[] = (
    (employees ?? []) as unknown as Array<
      Omit<EmployeeRow, 'schedule'> & {
        pay_schedule: string | null
        pay_frequency: string | null
        country: string | null
      }
    >
  ).map(({ pay_schedule, pay_frequency, country, ...person }) => ({
    ...person,
    schedule: effectivePaySchedule({ pay_schedule, pay_frequency, country }),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Salaries are paid by your payroll provider. This is where employees confirm they received them."
      />
      <PayrollReview
        employees={people}
        confirmations={(confirmations ?? []) as unknown as ConfirmationRow[]}
        payslips={(payslips ?? []) as unknown as PayslipRow[]}
        company={company}
        month={month}
        year={year}
      />
    </div>
  )
}
