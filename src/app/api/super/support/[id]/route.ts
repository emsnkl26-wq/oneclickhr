import { NextRequest } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { supportStatusSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Move a support request through the queue.
 *
 * PLATFORM ONLY. 028's update policy already refuses everyone but a super
 * admin; `apiRequireSuperAdmin()` is what turns that refusal into a clean 403
 * instead of a confusing empty result.
 *
 * `resolved_at` is set and cleared alongside the status rather than left to
 * drift: a row marked resolved and then reopened with a stale timestamp reads
 * as having been fixed before it was reported.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, supportStatusSchema)
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('support_requests')
    .update({
      status: input.status,
      resolution_note: input.resolutionNote,
      assigned_to: ctx.userId,
      resolved_at: input.status === 'resolved' ? new Date().toISOString() : null,
    })
    .eq('id', id)
    .select('id, tenant_id, subject')
    .maybeSingle()

  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That request was not found.', 404)

  await audit({
    // Recorded against the reporting workspace, so an org's own history shows
    // that we acted on what they told us.
    tenantId: data.tenant_id,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `support.${input.status}`,
    entity: 'support_requests',
    entityId: id,
    meta: { subject: data.subject },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
