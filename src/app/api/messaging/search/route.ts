import { NextRequest } from 'next/server'
import { withErrorHandler, parseQuery, jsonOk, jsonError } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { messageSearchSchema } from '@/lib/schemas'
import { searchMessages } from '@/lib/messaging'
import { rateLimit, limitKey } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * Find a message, across every conversation the caller is in.
 *
 * SCOPED BY RLS AND BY NOTHING ELSE. `messages_select` is membership, so a
 * search cannot reach a room the searcher is not in — including, for an
 * administrator, every room they merely manage. That is the whole reason this
 * can be one query over `messages` rather than a per-conversation fan-out.
 *
 * Rate limited because full-text search is the most expensive read in the
 * feature and the easiest to issue in a loop from a keystroke handler. The
 * client debounces; this is what makes the debounce not a security control.
 */
async function handleGET(request: NextRequest) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await rateLimit(limitKey('message:search', ctx.userId), 60, 60 * 1000)
  if (!limited.ok) return jsonError('Too many searches. Please wait a moment.', 429)

  const query = parseQuery(request, messageSearchSchema)
  const supabase = await createSupabaseServerClient()

  const messages = await searchMessages(supabase, ctx, {
    q: query.q,
    conversationId: query.conversationId,
    limit: query.limit,
  })

  return jsonOk({ messages })
}

export const GET = withErrorHandler(handleGET)
