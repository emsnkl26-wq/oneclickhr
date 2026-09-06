import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatusChip } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { TicketThread, type ThreadMessage } from '@/components/helpdesk/ticket-thread'
import type { TicketPriority, TicketStatus, UserRole } from '@/types/db'

export const metadata: Metadata = { title: 'Ticket' }
export const dynamic = 'force-dynamic'

interface MessageRow {
  id: string
  author_id: string | null
  author_role: UserRole
  body: string
  attachment_url: string | null
  attachment_name: string | null
  created_at: string
  author: { full_name: string | null; email: string | null; photo_url: string | null } | null
}

/** One thread, from the org's side — same component, plus the status control. */
export default async function OrgTicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireOrg()
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  /*
   * Both reads at once. The thread is keyed on the id from the URL, not on
   * anything the ticket row supplies, so waiting for the ticket before asking
   * for its messages bought nothing and cost a second serial round trip on
   * every open of a thread.
   *
   * Racing them does not widen what anyone can read: `ticket_messages` carries
   * its own RLS policy, so a thread the caller may not see comes back empty on
   * its own account, and the `notFound()` below still runs before any of it is
   * rendered.
   */
  const [
    { data: ticket, error: ticketError },
    { data: messages },
  ] = await Promise.all([
    supabase
      .from('tickets')
      .select('id, code, subject, description, priority, status, attachment_url, attachment_name, created_at, employee_id, employee:profiles!tickets_employee_id_fkey(full_name, email, photo_url)')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('ticket_messages')
      .select('id, author_id, author_role, body, attachment_url, attachment_name, created_at, author:profiles(full_name, email, photo_url)')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true }),
  ])

  // A read that FAILED is not a record that is missing. Answering both with
  // notFound() tells someone it was deleted when the database was simply
  // unreachable, which is the one explanation they cannot act on.
  if (ticketError) {
    console.error('[org/helpdesk/:id] load failed', ticketError)
    throw new Error('That ticket could not be loaded. Please try again.')
  }

  if (!ticket) notFound()

  const employee = ticket.employee as unknown as {
    full_name: string | null
    email: string | null
    photo_url: string | null
  } | null

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Ticket ${ticket.code}`}
        description={ticket.subject}
        actions={
          <>
            <StatusChip status={ticket.status as TicketStatus} className="self-center" />
            <Button asChild variant="secondary">
              <Link href="/org/helpdesk">
                <ArrowLeft />
                All tickets
              </Link>
            </Button>
          </>
        }
      />

      <TicketThread
        viewer="org"
        timezone={ctx.tenant.timezone}
        orgName={ctx.tenant.name}
        ticket={{
          id: ticket.id,
          code: ticket.code,
          subject: ticket.subject,
          description: ticket.description,
          priority: ticket.priority as TicketPriority,
          status: ticket.status as TicketStatus,
          attachmentKey: ticket.attachment_url,
          attachmentName: ticket.attachment_name,
          createdAt: ticket.created_at,
          employeeId: ticket.employee_id,
          employeeName: employee?.full_name || employee?.email || 'Employee',
          employeePhoto: employee?.photo_url ?? null,
        }}
        messages={((messages ?? []) as unknown as MessageRow[]).map<ThreadMessage>((message) => ({
          id: message.id,
          authorRole: message.author_role,
          authorName: message.author?.full_name || message.author?.email || '',
          authorPhoto: message.author?.photo_url ?? null,
          body: message.body,
          attachmentKey: message.attachment_url,
          attachmentName: message.attachment_name,
          createdAt: message.created_at,
        }))}
      />
    </div>
  )
}
