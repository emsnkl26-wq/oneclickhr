import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { LeaveQueue, type LeaveRow } from './leave-queue'
import type { LeaveStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Leaves' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const FILTERS = ['pending', 'decided', 'all'] as const
type Filter = (typeof FILTERS)[number]

/** Shape PostgREST returns for the row + its embedded applicant. */
interface LeaveWithEmployee {
  id: string
  employee_id: string
  start_date: string
  end_date: string
  days: number
  reason: string
  status: LeaveStatus
  decision_note: string | null
  decided_at: string | null
  created_at: string
  employee: { full_name: string | null; email: string | null; photo_url: string | null } | null
}

/**
 * The approval queue — filtered, searched and paged by the database.
 *
 * Two things changed here and both were costing every request:
 *
 *   • The applicant's name arrived from a SECOND query (`profiles.in(ids)`)
 *     that could not start until the leave query had returned. It is now an
 *     embedded join — one round trip, and Postgres does the matching.
 *   • The status tabs filtered 300 rows in the browser, which meant fetching
 *     the decided history of the whole workspace to show the four pending
 *     requests someone actually came here for.
 *
 * `!inner` on the embed is what lets the search filter parent rows by the
 * applicant's name; without it the filter would only prune the embedded object
 * and leave the leave row behind with a null employee.
 */
export default async function LeavesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const filter: Filter = FILTERS.includes(params.status as Filter)
    ? (params.status as Filter)
    : 'pending'
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = supabase
    .from('leaves')
    .select(
      'id, employee_id, start_date, end_date, days, reason, status, decision_note, decided_at, created_at, employee:profiles!leaves_employee_id_fkey!inner(full_name, email, photo_url)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (filter === 'pending') query = query.eq('status', 'pending')
  if (filter === 'decided') query = query.neq('status', 'pending')
  if (search) query = query.ilike('employee.full_name', `%${search}%`)

  // The pending badge has to survive the "decided" tab, so it is its own count.
  // `head: true` means no rows come back — just the number.
  const [{ data, count }, pending] = await Promise.all([
    query,
    supabase.from('leaves').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ])

  const rows: LeaveRow[] = ((data ?? []) as unknown as LeaveWithEmployee[]).map((leave) => ({
    id: leave.id,
    employee_id: leave.employee_id,
    employeeName: leave.employee?.full_name || leave.employee?.email || 'Employee',
    employeePhoto: leave.employee?.photo_url ?? null,
    start_date: leave.start_date,
    end_date: leave.end_date,
    days: leave.days,
    reason: leave.reason,
    status: leave.status,
    decision_note: leave.decision_note,
    decided_at: leave.decided_at,
    created_at: leave.created_at,
  }))

  return (
    <div className="space-y-6">
      <PageHeader title="Leaves" description="Approve or decline requests from your team." />
      <LeaveQueue
        leaves={rows}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filter={filter}
        pendingCount={pending.count ?? 0}
        searching={!!search}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
