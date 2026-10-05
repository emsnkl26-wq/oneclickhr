import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MessageSquare } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadSupportMessages } from '@/lib/support-thread'
import { PageHeader, EmptyState, StatusChip } from '@/components/ui/patterns'
import { RequesterThread } from './requester-thread'

/**
 * A person's own support requests and the platform's answers (056). Shared by
 * /org/support and /employee/support; both read through the user-scoped
 * client, so `support_requests_select` is what confines them to the caller.
 */

const STATUS_LABELS: Record<string, string> = { new: 'Sent', in_progress: 'In progress', resolved: 'Resolved' }

interface RequestRow {
  id: string
  subject: string
  message: string
  status: 'new' | 'in_progress' | 'resolved'
  created_at: string
  last_reply_at: string | null
  requester_unread: boolean
  reporter_name: string | null
}

export async function MySupportList({ userId, base }: { userId: string; base: string }) {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('support_requests')
    .select('id, subject, message, status, created_at, last_reply_at, requester_unread, reporter_name')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  const rows = (data ?? []) as RequestRow[]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support"
        description="What you have asked the OneclickHR team, and their replies. Use the Support button at the bottom of any page to send something new."
      />
      {rows.length === 0 ? (
        <div className="card-surface">
          <EmptyState
            icon={MessageSquare}
            title="No requests yet"
            description="Questions and problems you send with the Support button appear here, with our replies."
          />
        </div>
      ) : (
        <ul className="card-surface divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`${base}/${row.id}`} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-page">
                <span
                  className={`size-2 shrink-0 rounded-full ${row.requester_unread ? 'bg-brand-500' : 'bg-transparent'}`}
                  aria-label={row.requester_unread ? 'New reply' : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${row.requester_unread ? 'font-semibold' : 'font-medium'}`}>
                    {row.subject}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {row.requester_unread ? 'New reply from support · ' : ''}
                    {new Date(row.last_reply_at ?? row.created_at).toLocaleDateString(undefined, {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </span>
                </span>
                <StatusChip status={row.status} label={STATUS_LABELS[row.status]} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export async function MySupportThread({ userId, id, base }: { userId: string; id: string; base: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('support_requests')
    .select('id, subject, message, status, created_at, last_reply_at, requester_unread, reporter_name')
    .eq('id', id)
    .eq('profile_id', userId)
    .maybeSingle()
  const row = data as RequestRow | null
  if (!row) notFound()

  const messages = await loadSupportMessages(supabase, id)

  // Opening the thread is reading it. Service role: the requester has no
  // write path to support rows, by design.
  if (row.requester_unread) {
    await createAdminClient().from('support_requests').update({ requester_unread: false }).eq('id', id)
  }

  return (
    <div className="space-y-6">
      <Link href={base} className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        All requests
      </Link>
      <PageHeader title={row.subject} actions={<StatusChip status={row.status} label={STATUS_LABELS[row.status]} />} />
      <div className="card-surface p-5">
        <RequesterThread
          id={row.id}
          original={{ authorName: row.reporter_name, body: row.message, createdAt: row.created_at }}
          messages={messages}
          closed={row.status === 'resolved'}
        />
      </div>
    </div>
  )
}
