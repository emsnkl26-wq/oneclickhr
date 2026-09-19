import type { Metadata } from 'next'
import Link from 'next/link'
import { Bell, ChevronRight } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusChip } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatLocal } from '@/lib/time'
import { notificationImageSrc } from '@/lib/notification-image'
import { PushToggle } from '@/components/notifications/push-toggle'
import { cardPathFor } from '@/lib/notifications/events'
import type { NotificationEvent } from '@/lib/notifications/events'
import { NotificationReader } from './notification-reader'

export const metadata: Metadata = { title: 'Notifications' }
export const dynamic = 'force-dynamic'

export default async function EmployeeNotificationsPage() {
  const ctx = await requireEmployee()
  const supabase = await createSupabaseServerClient()

  /*
   * The audience rule lives in the `notifications_select` policy, not here.
   * Postgres returns exactly the rows addressed to everyone, to this person's
   * department, or to this person — evaluated at READ time, so a department
   * change is reflected immediately without rewriting any notification.
   */
  const [{ data: notifications }, { data: reads }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, title, description, send_to_type, image_url, event, subject_id, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('notification_reads').select('notification_id'),
  ])

  const readIds = new Set((reads ?? []).map((r) => r.notification_id))
  /*
   * `href` is resolved here rather than in the card so the decision sits next to
   * the data it is made from. An announcement points at this very page, which is
   * not a link worth offering — the catalog's fallback IS the notifications
   * list, so a card that resolves to it stays plain text.
   */
  const rows = (notifications ?? []).map((n) => {
    const href = cardPathFor(
      (n.event ?? undefined) as NotificationEvent | undefined,
      'employee',
      n.subject_id
    )
    return {
      ...n,
      read: readIds.has(n.id),
      href: href === '/employee/notifications' ? null : href,
    }
  })
  const unread = rows.filter((r) => !r.read)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={
          unread.length
            ? `${unread.length} unread ${unread.length === 1 ? 'message' : 'messages'}.`
            : 'You are all caught up.'
        }
        actions={unread.length ? <NotificationReader ids={unread.map((r) => r.id)} /> : undefined}
      />

      <PushToggle />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Bell}
            title="Nothing yet"
            description="Announcements from your organization will appear here."
          />
        </Card>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((item) => {
            /* A card with somewhere to go becomes ONE link over its whole
               surface rather than a link buried in the text — the destination
               is the subject of the card, so the card is the hit area. Without
               a destination it stays a plain block: a pointer cursor that
               promises a navigation and then does nothing is worse than no
               affordance at all. */
            const className = cn(
              'card-surface block p-5',
              item.read ? null : 'border-brand-200 bg-brand-50/40',
              item.href &&
                'transition-colors hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2'
            )
            const body = (
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{item.title}</p>
                    {!item.read ? <StatusChip status="brand" tone="brand" label="New" /> : null}
                    {item.send_to_type === 'employee' ? (
                      <StatusChip status="info" tone="info" label="Just for you" />
                    ) : null}
                  </div>
                  {item.description ? (
                    <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-ink-muted">
                      {item.description}
                    </p>
                  ) : null}
                  {item.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={notificationImageSrc(item.image_url) as string}
                      alt=""
                      className="mt-3 max-h-80 w-full rounded-lg border border-line object-cover"
                    />
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className="whitespace-nowrap text-xs text-ink-muted">
                    {formatLocal(item.created_at, ctx.tenant.timezone, 'd MMM, HH:mm')}
                  </span>
                  {item.href ? (
                    <ChevronRight className="size-4 text-ink-muted" aria-hidden />
                  ) : null}
                </div>
              </div>
            )
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className={className}>
                    {body}
                  </Link>
                ) : (
                  <div className={className}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
