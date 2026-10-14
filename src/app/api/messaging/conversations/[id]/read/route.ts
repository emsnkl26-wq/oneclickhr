import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, uuidSchema } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { markRead } from '@/lib/messaging'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * "I have read this far."
 *
 * Called when the thread is opened and when the reader reaches its bottom, so
 * it is the second most frequent write in the feature. It is deliberately the
 * cheapest: one UPDATE of one row, no read first, and the "never move
 * backwards" rule lives in the WHERE clause (see `markRead`) rather than in a
 * compare-and-set round trip.
 *
 * ALWAYS 200, even for a conversation the caller is not in — the UPDATE simply
 * matches no row. There is nothing for the UI to do about a failure here and
 * nothing to tell the user, and answering 404 would only hand an unauthorized
 * caller a way to probe which conversation ids exist.
 */
async function handlePOST(_request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response

  const conversationId = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()
  await markRead(supabase, conversationId)

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
