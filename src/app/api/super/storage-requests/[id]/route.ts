import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyOrgAdmins } from '@/lib/notify'
import { formatBytes } from '@/lib/storage-quota'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const decisionSchema = z.object({
  status: z.enum(['approved', 'declined']),
  /** What to add, in GB — defaults to what was asked for. */
  gigabytes: z.coerce.number().int().min(1).max(10_000).optional(),
  note: z.string().trim().max(2000).optional().transform((v) => v || null),
})

/**
 * Decide a storage request (056). Approving ADDS the granted space to the
 * workspace's current limit, so two approvals stack the way they read.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, decisionSchema)
  const admin = createAdminClient()

  const { data: row } = await admin
    .from('storage_requests')
    .select('id, tenant_id, status, requested_bytes')
    .eq('id', id)
    .maybeSingle()
  if (!row) return jsonError('That request was not found.', 404)
  if (row.status !== 'pending') return jsonError('That request has already been decided.', 409)

  const granted = input.status === 'approved'
    ? (input.gigabytes ? input.gigabytes * 1024 ** 3 : Number(row.requested_bytes))
    : null

  if (granted) {
    const { data: tenant } = await admin
      .from('tenants')
      .select('storage_limit_bytes')
      .eq('id', row.tenant_id)
      .single()
    const { error: limitError } = await admin
      .from('tenants')
      .update({ storage_limit_bytes: Number(tenant?.storage_limit_bytes ?? 0) + granted })
      .eq('id', row.tenant_id)
    if (limitError) return jsonError(friendlyDbError(limitError), 400)
  }

  const { error } = await admin
    .from('storage_requests')
    .update({
      status: input.status,
      granted_bytes: granted,
      admin_note: input.note,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await notifyOrgAdmins(admin, {
    tenantId: row.tenant_id,
    title: granted
      ? `Storage increased by ${formatBytes(granted)}`
      : 'Your storage request was declined',
    description: input.note,
    createdBy: ctx.userId,
  })

  await audit({
    tenantId: row.tenant_id,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: `storage.${input.status}`,
    entity: 'storage_requests',
    entityId: id,
    meta: { grantedBytes: granted },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
