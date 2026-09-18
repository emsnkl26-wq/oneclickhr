import { Building2 } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState, StatusChip } from '@/components/ui/patterns'
import { formatDateLabel } from '@/lib/time'
import { formatMoney } from '@/lib/utils'
import type { MyAssignment } from '@/types/db'

/**
 * The columns this card reads. Every one of them exists on `my_assignments`
 * (022), which is the ONLY place an employee may read a placement from: the
 * base table is org-only under RLS, and the view is filtered to
 * `employee_id = auth.uid()` and does not select `bill_rate` at all. Never
 * point this at `employee_assignments`.
 */
const COLUMNS =
  'id, vendor_name, client_name, pay_rate, pay_currency, rate_unit, start_date, end_date, is_primary, status'

type Row = Pick<
  MyAssignment,
  | 'id' | 'vendor_name' | 'client_name' | 'pay_rate' | 'pay_currency' | 'rate_unit'
  | 'start_date' | 'end_date' | 'is_primary' | 'status'
>

/** "My placements" — read-only, for the employee dashboard. */
export async function MyPlacementsCard({ supabase }: { supabase: SupabaseClient }) {
  const { data, error } = await supabase
    .from('my_assignments')
    .select(COLUMNS)
    .order('is_primary', { ascending: false })
    .order('start_date', { ascending: false, nullsFirst: false })

  if (error) console.error('[employee] my_assignments load failed', error.message)
  const rows = (data ?? []) as unknown as Row[]

  return (
    <Card>
      <CardHeader>
        <CardTitle>My placements</CardTitle>
      </CardHeader>
      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No placements yet"
          description="When you are placed with a client, the details will show here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {row.client_name || 'End client not set'}
                  {row.is_primary ? (
                    <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                      Primary
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  Vendor · {row.vendor_name || '—'}
                </p>
                <p className="tabular mt-0.5 text-xs text-ink-muted">
                  {formatDateLabel(row.start_date)}
                  {row.end_date ? ` – ${formatDateLabel(row.end_date)}` : ' – ongoing'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular text-sm font-semibold">
                  {row.pay_rate != null
                    ? `${formatMoney(row.pay_rate, row.pay_currency)} / ${row.rate_unit}`
                    : 'Pay rate not set'}
                </span>
                <StatusChip status={row.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
