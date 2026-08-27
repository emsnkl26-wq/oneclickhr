import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatCard, LoadError } from '@/components/ui/patterns'
import { LeaveManager } from './leave-manager'
import { todayIn } from '@/lib/time'
import type { LeaveStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Leaves' }
export const dynamic = 'force-dynamic'

export default async function MyLeavesPage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()

  const { data: leaves, error: loadError } = await supabase
    .from('leaves')
    .select('id, start_date, end_date, days, reason, status, decision_note, decided_at, created_at')
    .order('created_at', { ascending: false })

  const rows = leaves ?? []
  const approvedDays = rows
    .filter((l) => l.status === 'approved')
    .reduce((sum, l) => sum + l.days, 0)
  const pending = rows.filter((l) => l.status === 'pending').length

  if (loadError) console.error('[employee/leaves] load failed', loadError)

  return (
    <div className="space-y-6">
      <PageHeader title="Leaves" description="Apply for time off and track your requests." />

      {loadError ? <LoadError what="Your leave requests" /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Approved days" value={approvedDays} accent />
        <StatCard label="Awaiting decision" value={pending} />
        <StatCard label="Total requests" value={rows.length} />
      </div>

      <LeaveManager
        leaves={rows as Array<(typeof rows)[number] & { status: LeaveStatus }>}
        timezone={ctx.tenant.timezone}
        today={todayIn(ctx.tenant.timezone)}
      />
    </div>
  )
}
