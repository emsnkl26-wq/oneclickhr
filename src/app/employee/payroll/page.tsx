import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { PayrollUploader, type ConfirmationRow, type PayslipRow } from './payroll-uploader'
import { effectivePaySchedule, recentPeriods } from '@/lib/pay-schedule'
import { todayIn } from '@/lib/time'

export const metadata: Metadata = { title: 'My pay' }
export const dynamic = 'force-dynamic'

/** How many months back the page offers. A year covers every realistic catch-up. */
const MONTHS_SHOWN = 12

/**
 * "Confirm you were paid" — the employee's half of payroll.
 *
 * The org does not upload payslips here any more (026): payroll runs in ADP and
 * the money arrives without this product's involvement, so what the product
 * collects is the employee's confirmation that it did.
 *
 * Payslips uploaded BEFORE that change are still listed. They are real
 * documents somebody may still need, and hiding them to keep the new screen
 * tidy would be deleting history from the person it belongs to.
 */
export default async function EmployeePayrollPage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()

  const [{ data: confirmations }, { data: payslips }, { data: me }] = await Promise.all([
    supabase
      .from('payment_confirmations')
      .select(
        'id, month, year, period, amount, currency, paid_on, file_url, file_name, note, status, review_note, verified_at'
      )
      .eq('employee_id', ctx.userId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(72),
    supabase
      .from('payslips')
      .select('id, month, year, file_url, file_name, created_at')
      .eq('employee_id', ctx.userId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(24),
    supabase
      .from('profiles')
      .select('pay_schedule, pay_frequency, country')
      .eq('id', ctx.userId)
      .maybeSingle(),
  ])

  /*
   * The last twelve months, newest first — including the ones with nothing
   * against them, because an empty row is the prompt. A list of only what has
   * been uploaded can never show somebody what they have MISSED.
   */
  // Twice a month for someone paid semi-monthly (050): one row per half.
  const schedule = effectivePaySchedule(me ?? {})
  const periods = recentPeriods(schedule, todayIn(ctx.tenant.timezone), MONTHS_SHOWN)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My pay"
        description={
          schedule === 'semi_monthly'
            ? "You're paid twice a month. Upload the confirmation you received for each half — the 1st–15th and the 16th to month end."
            : "Your salary is paid directly by your organization's payroll. Upload the confirmation you received for each month."
        }
      />
      <PayrollUploader
        periods={periods}
        confirmations={(confirmations ?? []) as unknown as ConfirmationRow[]}
        payslips={(payslips ?? []) as unknown as PayslipRow[]}
      />
    </div>
  )
}
