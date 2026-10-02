import { withErrorHandler, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cardPathFor, type NotificationEvent } from '@/lib/notifications/events'

export const dynamic = 'force-dynamic'

/**
 * The bell's inbox: the latest notifications for the signed-in person, with
 * their read state and where each one links.
 *
 * An employee sees what `notifications_select` lets them read. An administrator
 * can read EVERY notification in the workspace under that policy, so their
 * inbox is narrowed to the ones addressed to them — otherwise every message the
 * workspace sends an employee would show up as the admin's own news.
 */
async function handleGET() {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('notifications')
    .select('id, title, description, send_to_type, event, subject_id, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (ctx.role !== 'employee') {
    query = query.eq('send_to_type', 'employee').eq('target_id', ctx.userId)
  }

  const [{ data, error }, { data: reads }] = await Promise.all([
    query,
    supabase.from('notification_reads').select('notification_id').eq('user_id', ctx.userId),
  ])
  if (error) return jsonError(friendlyDbError(error), 400)

  const readIds = new Set((reads ?? []).map((row) => row.notification_id as string))
  const role = ctx.role === 'employee' ? 'employee' : 'org'

  const items = (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    createdAt: row.created_at as string,
    personal: row.send_to_type === 'employee',
    read: readIds.has(row.id as string),
    href: cardPathFor((row.event ?? undefined) as NotificationEvent | undefined, role, row.subject_id),
  }))

  return jsonOk({
    items,
    unread: items.filter((item) => !item.read).length,
    // The org's notifications page is the announcements composer, not an inbox.
    allHref: role === 'employee' ? '/employee/notifications' : null,
  })
}

export const GET = withErrorHandler(handleGET)
