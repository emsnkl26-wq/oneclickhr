import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const requestSchema = z.object({
  /** Additional gigabytes wanted, on top of the current limit. */
  gigabytes: z.coerce.number().int('Whole gigabytes, please').min(1, 'At least 1 GB').max(1000),
  reason: z.string().trim().min(3, 'Tell us what the space is for').max(2000),
})

/**
 * Ask for more storage (056). No payment — a super admin reads the reason and
 * raises the limit by hand. One open request per workspace at a time, so a
 * second click does not queue a duplicate.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await rateLimit(limitKey('storage-request', ctx.tenantId), 5, 24 * 60 * 60 * 1000)
  if (!limited.ok) return jsonError('You have sent several requests today. We will get back to you.', 429)

  const input = await parseBody(request, requestSchema)
  const admin = createAdminClient()

  const { data: open } = await admin
    .from('storage_requests')
    .select('id')
    .eq('tenant_id', ctx.tenantId)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()
  if (open) return jsonError('You already have a request waiting. We will review it shortly.', 409)

  const { data, error } = await admin
    .from('storage_requests')
    .insert({
      tenant_id: ctx.tenantId,
      requested_by: ctx.userId,
      requested_bytes: input.gigabytes * 1024 ** 3,
      reason: input.reason,
    })
    .select('id')
    .single()
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'storage.requested',
    entity: 'storage_requests',
    entityId: data.id,
    meta: { gigabytes: input.gigabytes },
    request,
  })

  return jsonOk({ id: data.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
