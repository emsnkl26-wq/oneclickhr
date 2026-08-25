import type { Metadata } from 'next'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/ui/patterns'
import { TicketList, type TicketRow } from './ticket-list'

export const metadata: Metadata = { title: 'Help desk' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 25

/**
 * The employee's own tickets.
 *
 * No `.eq('employee_id', …)` here: `tickets_select` already restricts a
 * non-org caller to their own rows, and repeating the filter would suggest the
 * isolation depends on remembering to write it.
 */
export default async function EmployeeHelpDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()
  const params = await searchParams

  const page = Math.max(1, parseInt(params.page ?? '', 10) || 1)
  const offset = (page - 1) * PER_PAGE

  const { data, count } = await supabase
    .from('tickets')
    .select('id, code, subject, priority, status, created_at, last_activity_at', {
      count: 'exact',
    })
    .order('last_activity_at', { ascending: false })
    .range(offset, offset + PER_PAGE - 1)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Help desk"
        description="Raise a request with your organization and follow it through to an answer."
      />
      <TicketList
        tickets={(data ?? []) as unknown as TicketRow[]}
        total={count ?? 0}
        page={page}
        perPage={PER_PAGE}
        timezone={ctx.tenant.timezone}
      />
    </div>
  )
}
