import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { PayrollUploader, type ConfirmationRow, type PayslipRow } from './payroll-uploader'

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

  const [{ data: confirmations }, { data: payslips }] = await Promise.all([
    supabase
      .from('payment_confirmations')
      .select(
        'id, month, year, amount, currency, paid_on, file_url, file_name, note, status, review_note, verified_at'
      )
      .eq('employee_id', ctx.userId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(36),
    supabase
      .from('payslips')
      .select('id, month, year, file_url, file_name, created_at')
      .eq('employee_id', ctx.userId)
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(24),
  ])

  /*
   * The last twelve months, newest first — including the ones with nothing
   * against them, because an empty row is the prompt. A list of only what has
   * been uploaded can never show somebody what they have MISSED.
   */
  const now = new Date()
  const periods: Array<{ month: number; year: number }> = []
  for (let back = 0; back < MONTHS_SHOWN; back += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
    periods.push({ month: date.getUTCMonth() + 1, year: date.getUTCFullYear() })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My pay"
        description="Your salary is paid directly by your organization's payroll. Upload the confirmation you received for each month."
      />
      <PayrollUploader
        periods={periods}
        confirmations={(confirmations ?? []) as unknown as ConfirmationRow[]}
        payslips={(payslips ?? []) as unknown as PayslipRow[]}
      />
    </div>
  )
}
