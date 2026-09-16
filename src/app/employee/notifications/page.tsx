import type { Metadata } from 'next'
import { Bell } from 'lucide-react'
import { requireEmployee } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, EmptyState, StatusChip } from '@/components/ui/patterns'
import { Card } from '@/components/ui/card'
import { formatLocal } from '@/lib/time'
import { notificationImageSrc } from '@/lib/notification-image'
import { PushToggle } from '@/components/notifications/push-toggle'
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
      .select('id, title, description, send_to_type, image_url, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('notification_reads').select('notification_id'),
  ])

  const readIds = new Set((reads ?? []).map((r) => r.notification_id))
  const rows = (notifications ?? []).map((n) => ({ ...n, read: readIds.has(n.id) }))
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
        actions={
          unread.length ? <NotificationReader ids={unread.map((r) => r.id)} /> : undefined
        }
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
          {rows.map((item) => (
            <li key={item.id}>
              <Card className={item.read ? 'p-5' : 'border-brand-200 bg-brand-50/40 p-5'}>
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
                  <span className="shrink-0 whitespace-nowrap text-xs text-ink-muted">
                    {formatLocal(item.created_at, ctx.tenant.timezone, 'd MMM, HH:mm')}
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
