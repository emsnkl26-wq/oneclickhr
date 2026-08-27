import type { Metadata } from 'next'
import { Download, Wallet } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, LoadError } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MONTH_NAMES, formatLocal } from '@/lib/time'

export const metadata: Metadata = { title: 'My payslips' }
export const dynamic = 'force-dynamic'

export default async function MyPayslipsPage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()

  /*
   * No `.eq('employee_id', ...)` filter — and that is the point.
   *
   * The `payslips_select` policy restricts an employee to `employee_id =
   * auth.uid()`, so this query CANNOT return a colleague's payslip even without
   * a filter. The download link goes through /api/files/view, which re-checks
   * that a row this user can see actually references the key before signing a
   * URL for it.
   */
  const { data: payslips, error: loadError } = await supabase
    .from('payslips')
    .select('id, month, year, file_url, file_name, created_at')
    .order('year', { ascending: false })
    .order('month', { ascending: false })

  const rows = payslips ?? []

  if (loadError) console.error('[employee/payslips] load failed', loadError)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My payslips"
        description="Only you can open these. Links expire after a few minutes."
      />

      {loadError ? <LoadError what="Your payslips" /> : null}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No payslips yet"
            description="Your payslips appear here as soon as your organization uploads them."
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((payslip) => (
            <li key={payslip.id}>
              <Card className="flex items-center gap-4 p-4">
                <span className="tabular grid w-14 shrink-0 rounded-lg bg-brand-50 py-2 text-center text-brand-700">
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    {MONTH_NAMES[payslip.month - 1]?.slice(0, 3)}
                  </span>
                  <span className="text-sm font-bold leading-tight">{payslip.year}</span>
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {MONTH_NAMES[payslip.month - 1]} {payslip.year}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">
                    Added {formatLocal(payslip.created_at, ctx.tenant.timezone, 'd MMM yyyy')}
                  </p>
                </div>

                <Button asChild size="icon" variant="secondary" aria-label="Download payslip">
                  <a
                    href={`/api/files/view?key=${encodeURIComponent(payslip.file_url)}&download=${encodeURIComponent(
                      payslip.file_name || `payslip-${payslip.year}-${payslip.month}.pdf`
                    )}`}
                  >
                    <Download />
                  </a>
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
