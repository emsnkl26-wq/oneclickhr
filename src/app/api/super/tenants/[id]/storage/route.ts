import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const limitSchema = z.object({
  gigabytes: z.coerce.number().min(0.1, 'At least 0.1 GB').max(100_000),
})

/** Set a workspace's storage limit outright (056), with or without a request. */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const { gigabytes } = await parseBody(request, limitSchema)
  const bytes = Math.round(gigabytes * 1024 ** 3)

  const { data, error } = await createAdminClient()
    .from('tenants')
    .update({ storage_limit_bytes: bytes })
    .eq('id', id)
    .select('id, name')
    .maybeSingle()
  if (error) return jsonError(friendlyDbError(error), 400)
  if (!data) return jsonError('That organization was not found.', 404)

  await audit({
    tenantId: id,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'storage.limit_set',
    entity: 'tenants',
    entityId: id,
    meta: { bytes },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
