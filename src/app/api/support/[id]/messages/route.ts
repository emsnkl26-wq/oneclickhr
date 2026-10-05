import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireTenantUser } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { supportReplySchema } from '@/lib/support-thread'
import { rateLimit, limitKey } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * The requester writes back on their own request (056).
 *
 * Only the person who filed it — checked here against `profile_id`, because the
 * write itself goes through the service role. A resolved request that gets a
 * follow-up is reopened, so it reappears in the platform's queue instead of
 * sitting answered-but-unread under "resolved".
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireTenantUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await rateLimit(limitKey('support-reply', ctx.userId), 30, 60 * 60 * 1000)
  if (!limited.ok) return jsonError('You have sent several messages recently. Please wait a little.', 429)

  const id = uuidSchema.parse((await params).id)
  const { body } = await parseBody(request, supportReplySchema)
  const admin = createAdminClient()

  const { data: support } = await admin
    .from('support_requests')
    .select('id, profile_id, status')
    .eq('id', id)
    .maybeSingle()
  if (!support || support.profile_id !== ctx.userId) return jsonError('That request was not found.', 404)

  const { error } = await admin.from('support_messages').insert({
    request_id: id,
    requester_id: ctx.userId,
    author_id: ctx.userId,
    from_platform: false,
    author_name: ctx.fullName || ctx.email,
    body,
  })
  if (error) return jsonError(friendlyDbError(error), 400)

  await admin
    .from('support_requests')
    .update({
      last_reply_at: new Date().toISOString(),
      ...(support.status === 'resolved' ? { status: 'in_progress', resolved_at: null } : {}),
    })
    .eq('id', id)

  return jsonOk({ ok: true }, 201)
}

export const POST = withErrorHandler(handlePOST)
