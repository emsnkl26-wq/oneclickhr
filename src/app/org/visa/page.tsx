import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { VisaManager } from './visa-manager'

export const metadata: Metadata = { title: 'Work authorization' }
export const dynamic = 'force-dynamic'

/** The columns this page selects, mirroring `VisaManager`'s own record shape. */
interface WorkAuthRow {
  id: string
  employee_id: string
  visa_type: string
  visa_number: string | null
  start_date: string | null
  expiry_date: string
  document_url: string | null
  notes: string | null
}

export default async function VisaPage() {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()

  /*
   * The milestones come back EMBEDDED in each work authorization rather than as
   * a table of their own.
   *
   * `visa_reminder_logs` was previously selected whole — no filter of any kind —
   * and joined to the records in JavaScript. RLS kept that to one tenant, so it
   * was never a correctness problem, but it is a log table: it gains a row every
   * time the cron sends a reminder and never loses one, including for visas that
   * have long since expired and dropped off this screen. The page was therefore
   * reading a set that grows without bound to display a set that does not.
   *
   * The embed is scoped by the foreign key, so only the logs belonging to the
   * records actually being shown are read, and `visa_reminder_once`
   * (work_auth_id, milestone) indexes the lookup on its leading column. It also
   * costs one round trip rather than two, and the join happens in Postgres
   * instead of in a serverless function's heap.
   */
  const [{ data: records }, { data: employees }] = await Promise.all([
    // Soonest expiry first — the whole point of this screen is what is coming up.
    supabase
      .from('work_authorizations')
      .select(
        'id, employee_id, visa_type, visa_number, start_date, expiry_date, document_url, notes, visa_reminder_logs(milestone)'
      )
      .order('expiry_date', { ascending: true }),
    supabase
      .from('profiles')
      .select('id, full_name, email, photo_url')
      .eq('role', 'employee')
      .eq('is_active', true)
      .order('full_name'),
  ])

  /** A one-to-many embed arrives as an array, empty when nothing matched. */
  type EmbeddedReminders = { visa_reminder_logs: Array<{ milestone: number }> | null }

  const rows = ((records ?? []) as unknown as Array<WorkAuthRow & EmbeddedReminders>).map(
    ({ visa_reminder_logs, ...record }) => ({
      ...record,
      // Still newest-milestone-first, exactly as the in-memory join produced.
      sentMilestones: (visa_reminder_logs ?? []).map((log) => log.milestone).sort((a, b) => b - a),
    })
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work authorization"
        description="H-1B records and the reminders already sent. Each milestone is sent once and never repeats."
      />
      <VisaManager
        records={rows}
        employees={employees ?? []}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
