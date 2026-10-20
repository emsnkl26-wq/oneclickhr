import { withErrorHandler, jsonOk } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * The sidebar's badge: how many unread messages, and in how many rooms.
 *
 * One RPC. `messaging_unread()` (062) answers for the caller and only the
 * caller — it is SECURITY DEFINER with `auth.uid()` in its WHERE clause — so
 * there is no per-conversation query here and no fan-out to cap.
 *
 * Deliberately separate from `/api/messaging/conversations`, which returns the
 * same numbers plus every room and the whole people directory. The badge is
 * mounted on EVERY authenticated page in the product and the conversation list
 * on one; making the cheap caller pay for the expensive one's payload is how a
 * badge becomes the slowest thing in a layout.
 *
 * Never fails loudly: a badge that could not be counted shows nothing, which is
 * what it showed a second ago, and the next event re-asks.
 */
async function handleGET() {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('messaging_unread')
  if (error) return jsonOk({ total: 0, rooms: 0 })

  const rows = (data ?? []) as Array<{ unread: number }>
  const counts = rows.map((row) => Number(row.unread) || 0)

  return jsonOk({
    total: counts.reduce((sum, count) => sum + count, 0),
    // How many CONVERSATIONS are waiting, which is the more useful number on a
    // nav item: "3" next to Messages means three threads to open, not three
    // messages in one of them.
    rooms: counts.filter((count) => count > 0).length,
  })
}

export const GET = withErrorHandler(handleGET)
