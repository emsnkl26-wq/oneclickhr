import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { TicketQueue, type QueueTicket } from './ticket-queue'
import type { TicketPriority, TicketStatus } from '@/types/db'

export const metadata: Metadata = { title: 'Help desk' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 50
const STATUS_FILTERS = ['open_all', 'open', 'in_progress', 'resolved', 'closed', 'all'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]
const PRIORITY_FILTERS = ['low', 'medium', 'high'] as const

interface TicketWithEmployee {
  id: string
  code: string
  subject: string
  priority: TicketPriority
  status: TicketStatus
  employee_id: string
  created_at: string
  last_activity_at: string
  employee: { full_name: string | null; email: string | null; photo_url: string | null } | null
}

/**
 * Every ticket in the workspace, filtered and paged by the database.
 *
 * The default tab is `open_all` — open AND in-progress together — because "what
 * is still on my plate" is the question this screen exists to answer, and
 * splitting it across two tabs means the count on either one is never the answer.
 */
export default async function OrgHelpDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; q?: string; page?: string }>
}) {
  const ctx = await requireOrg()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const filter: StatusFilter = STATUS_FILTERS.includes(params.status as StatusFilter)
    ? (params.status as StatusFilter)
    : 'open_all'
  const priority = PRIORITY_FILTERS.includes(params.priority as never) ? params.priority! : ''
  const search = params.q?.trim() || ''
  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  let query = supabase
    .from('tickets')
    .select(
      'id, code, subject, priority, status, employee_id, created_at, last_activity_at, employee:profiles!tickets_employee_id_fkey!inner(full_name, email, photo_url)',
      { count: 'exact' }
    )
    .order('last_activity_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  if (filter === 'open_all') query = query.in('status', ['open', 'in_progress'])
  else if (filter !== 'all') query = query.eq('status', filter)
  if (priority) query = query.eq('priority', priority)
  if (search) query = query.ilike('employee.full_name', `%${search}%`)

  const [{ data, count }, openCount] = await Promise.all([
    query,
    supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress']),
  ])

  const rows: QueueTicket[] = ((data ?? []) as unknown as TicketWithEmployee[]).map((ticket) => ({
    id: ticket.id,
    code: ticket.code,
    subject: ticket.subject,
    priority: ticket.priority,
    status: ticket.status,
    employeeId: ticket.employee_id,
    employeeName: ticket.employee?.full_name || ticket.employee?.email || 'Employee',
    employeePhoto: ticket.employee?.photo_url ?? null,
    createdAt: ticket.created_at,
    lastActivityAt: ticket.last_activity_at,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help desk"
        description="Requests your team has raised — IT, HR, access, anything else."
      />
      <TicketQueue
        tickets={rows}
        total={count ?? rows.length}
        page={page}
        perPage={PER_PAGE}
        filter={filter}
        priority={priority}
        openCount={openCount.count ?? 0}
        searching={!!search || !!priority}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
