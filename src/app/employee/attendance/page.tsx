import type { Metadata } from 'next'
import { CalendarCheck } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatCard, EmptyState, StatusChip, LoadError } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { formatLocal, todayIn } from '@/lib/time'
import { formatHours } from '@/lib/utils'
import { AttendanceFilter } from './attendance-filter'

export const metadata: Metadata = { title: 'My attendance' }
export const dynamic = 'force-dynamic'

export default async function MyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()
  const tz = ctx.tenant.timezone
  const params = await searchParams

  const today = todayIn(tz)
  const defaultFrom = `${today.slice(0, 7)}-01`
  const from = /^\d{4}-\d{2}-\d{2}$/.test(params.from ?? '') ? params.from! : defaultFrom
  const to = /^\d{4}-\d{2}-\d{2}$/.test(params.to ?? '') ? params.to! : today

  // RLS restricts `attendance` to `employee_id = auth.uid()` for employees, so
  // this returns only their own rows without a filter that could be forgotten.
  const { data: records, error: loadError } = await supabase
    .from('attendance')
    .select('id, date, login_time, logout_time, total_hours, is_late')
    .gte('date', from)
    .lte('date', to)
    .order('date', { ascending: false })

  const rows = records ?? []
  const totalHours = rows.reduce((sum, r) => sum + Number(r.total_hours ?? 0), 0)
  const lateCount = rows.filter((r) => r.is_late).length

  if (loadError) console.error('[employee/attendance] load failed', loadError)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My attendance"
        description={`All times shown in ${tz}.`}
      />

      {loadError ? <LoadError what="Your attendance record" /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Days present" value={rows.length} accent />
        <StatCard label="Total hours" value={formatHours(totalHours)} />
        <StatCard label="Late logins" value={lateCount} />
      </div>

      <AttendanceFilter from={from} to={to} />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarCheck}
            title="Nothing in this range"
            description="Try widening the dates, or clock in from your dashboard."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="scrollbar-thin overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-page/60">
                  {['Date', 'Clock in', 'Clock out', 'Hours', 'Status'].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-muted"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((record) => (
                  <tr key={record.id} className="border-b border-line last:border-0">
                    <td className="tabular px-4 py-3 font-medium">{record.date}</td>
                    <td className="tabular px-4 py-3">
                      {formatLocal(record.login_time, tz, 'HH:mm')}
                    </td>
                    <td className="tabular px-4 py-3 text-ink-muted">
                      {record.logout_time
                        ? formatLocal(record.logout_time, tz, 'HH:mm')
                        : 'Still clocked in'}
                    </td>
                    <td className="tabular px-4 py-3 font-medium">
                      {formatHours(record.total_hours)}
                    </td>
                    <td className="px-4 py-3">
                      {!record.logout_time ? (
                        <StatusChip status="in_progress" label="Active" />
                      ) : record.is_late ? (
                        <StatusChip status="late" label="Late" />
                      ) : (
                        <StatusChip status="present" label="On time" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
