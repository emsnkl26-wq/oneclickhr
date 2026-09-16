import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { pushUnsubscribeSchema } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

/**
 * Turn this browser off.
 *
 * THE CALLER'S CLIENT, deliberately — the one route in this feature that does
 * not need the admin one. `push_subscriptions_delete` is `user_id = auth.uid()`,
 * so RLS is what confines the delete to rows the caller actually owns, and an
 * endpoint belonging to somebody else simply matches nothing. That is a better
 * guarantee than a service-role delete with a hand-written `.eq('user_id', …)`,
 * because it cannot be got wrong by omission.
 *
 * ALWAYS ANSWERS OK, including when nothing was deleted. The three reasons a
 * row might not be there — already removed, pruned as dead, never registered —
 * are all the state the caller wanted, and distinguishing them would only tell
 * an attacker whether a given endpoint is registered to the current user.
 * "Off" is the honest answer to all of them.
 *
 * Note the ORDER the client uses (see `disablePush`): the browser-side
 * `subscription.unsubscribe()` runs only after this returns. Doing it the other
 * way round loses the endpoint string on a failed request, leaving a row the
 * user has no way to reach again and a device that keeps buzzing.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const input = await parseBody(request, pushUnsubscribeSchema)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', input.endpoint)

  if (error) {
    // Logged, not surfaced. The user asked for this device to stop; telling them
    // it failed gives them nothing to act on, and the browser-side unsubscribe
    // that follows stops the notifications either way. The orphaned row, if any,
    // dies at its first 410 or on the staleness sweep.
    console.error('[push] could not remove subscription', error.message)
  }

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
