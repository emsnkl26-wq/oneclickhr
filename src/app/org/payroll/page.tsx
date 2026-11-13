import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import {
  PayrollReview, type ConfirmationRow, type EmployeeRow, type PayslipCompany, type PayslipRow,
} from './payroll-review'
import { FreelancerPayments, type FreelancerPaymentRow } from './freelancer-payments'
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

  // The calendar month, used to pull the freelancer invoices paid/issued in it.
  const mm = String(month).padStart(2, '0')
  const monthStart = `${year}-${mm}-01`
  const monthEnd = `${year}-${mm}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`

  const [{ data: employees }, { data: confirmations }, { data: payslips }, { data: tenant }, { data: freelancerInvoices }] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'id, full_name, email, photo_url, employee_code, designation, pay_schedule, pay_frequency, country, pay_rate, pay_currency, date_of_joining, hire_date, bank_name, street_address, apartment, city, state_province, zip_postal, pay_type, account_type'
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
      .select('name, logo_url, address_line1, address_line2, city, state_province, postal_code, country, company_email, company_phone, website, org_code')
      .eq('id', ctx.tenantId)
      .single(),
    // Freelancers are paid through freelancer invoices (046), not pay
    // confirmations — so their payments for the month are pulled here and shown
    // alongside the employees, "all in one place".
    supabase
      .from('invoices')
      .select('id, invoice_number, bill_to, total, currency, status, issue_date, paid_at, payout_amount, payout_currency, employee_id')
      .eq('invoice_type', 'freelancer')
      .gte('issue_date', monthStart)
      .lte('issue_date', monthEnd)
      .order('issue_date', { ascending: false }),
  ])

  // Put a name to each freelancer invoice's payee, when it is linked to a person.
  const freelancerIds = [
    ...new Set(
      ((freelancerInvoices ?? []) as Array<{ employee_id: string | null }>)
        .map((row) => row.employee_id)
        .filter((id): id is string => !!id)
    ),
  ]
  const freelancerNames = new Map<string, string>()
  if (freelancerIds.length) {
    const { data: freelancerProfiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', freelancerIds)
    for (const p of (freelancerProfiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      if (p.full_name) freelancerNames.set(p.id, p.full_name)
    }
  }

  const freelancerRows: FreelancerPaymentRow[] = (
    (freelancerInvoices ?? []) as Array<{
      id: string
      invoice_number: string
      bill_to: { name?: string } | null
      total: number | null
      currency: string
      status: string
      issue_date: string
      paid_at: string | null
      payout_amount: number | null
      payout_currency: string | null
      employee_id: string | null
    }>
  ).map((inv) => {
    // The payment to the freelancer is the payout where one is recorded,
    // otherwise the invoice total.
    const hasPayout = inv.payout_amount != null
    return {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      name:
        (inv.employee_id ? freelancerNames.get(inv.employee_id) : null) ??
        inv.bill_to?.name ??
        'Freelancer',
      amount: hasPayout ? Number(inv.payout_amount) : Number(inv.total ?? 0),
      currency: (hasPayout ? inv.payout_currency : inv.currency) ?? inv.currency,
      status: inv.status,
      issueDate: inv.issue_date,
      paidAt: inv.paid_at,
    }
  })

  // The payslip footer's one address line: "8795 Stonehouse Dr, Ellicott City, MD – 21043".
  const region = [tenant?.state_province, tenant?.postal_code].filter(Boolean).join(' – ')
  const company: PayslipCompany = {
    name: tenant?.name ?? ctx.tenant.name,
    logoUrl: tenant?.logo_url ?? null,
    address: [tenant?.address_line1, tenant?.address_line2, tenant?.city, region, tenant?.country]
      .filter(Boolean)
      .join(', '),
    email: tenant?.company_email ?? null,
    website: tenant?.website ?? null,
    phone: tenant?.company_phone ?? null,
    orgCode: tenant?.org_code ?? null,
    // "8795 Stonehouse Dr" / "Ellicott City, MD 21043" — the US statement's block.
    addressLines: [
      [tenant?.address_line1, tenant?.address_line2].filter(Boolean).join(', '),
      [tenant?.city, [tenant?.state_province, tenant?.postal_code].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', '),
    ].filter(Boolean),
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
      <FreelancerPayments rows={freelancerRows} month={month} year={year} />
    </div>
  )
}
