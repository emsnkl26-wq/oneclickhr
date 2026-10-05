import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { supportReplySchema, loadSupportMessages } from '@/lib/support-thread'
import { notifyEmployee } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** The thread, for the console's request dialog. */
async function handleGET(_request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response

  const id = uuidSchema.parse((await params).id)
  const messages = await loadSupportMessages(createAdminClient(), id)
  return jsonOk({ messages })
}

/**
 * The platform answers (056).
 *
 * The reply lands on the thread, the request is flagged unread for the person
 * who sent it, a new request moves to "in progress", and the requester is
 * notified in their portal — and by email, since `support.replied` is an
 * important event.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const { body } = await parseBody(request, supportReplySchema)
  const admin = createAdminClient()

  const { data: support } = await admin
    .from('support_requests')
    .select('id, tenant_id, profile_id, subject, status')
    .eq('id', id)
    .maybeSingle()
  if (!support) return jsonError('That request was not found.', 404)

  const { error } = await admin.from('support_messages').insert({
    request_id: id,
    requester_id: support.profile_id,
    author_id: ctx.userId,
    from_platform: true,
    author_name: 'OneclickHR Support',
    body,
  })
  if (error) return jsonError(friendlyDbError(error), 400)

  const now = new Date().toISOString()
  await admin
    .from('support_requests')
    .update({
      last_reply_at: now,
      requester_unread: true,
      assigned_to: ctx.userId,
      ...(support.status === 'new' ? { status: 'in_progress' } : {}),
    })
    .eq('id', id)

  if (support.tenant_id && support.profile_id) {
    await notifyEmployee(admin, {
      tenantId: support.tenant_id,
      employeeId: support.profile_id,
      title: `Support replied: ${support.subject}`.slice(0, 200),
      description: body.length > 240 ? `${body.slice(0, 237)}…` : body,
      createdBy: ctx.userId,
      event: 'support.replied',
      subjectId: id,
    })
  }

  await audit({
    tenantId: support.tenant_id,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'support.replied',
    entity: 'support_requests',
    entityId: id,
    meta: { subject: support.subject },
    request,
  })

  return jsonOk({ ok: true }, 201)
}

export const GET = withErrorHandler(handleGET)
export const POST = withErrorHandler(handlePOST)
