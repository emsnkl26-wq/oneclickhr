import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { applicationReviewSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Triage an applicant for one of ONECLICKHR'S OWN postings.
 *
 * The org route cannot serve this — `apiRequireOrg` refuses a super admin, and
 * `job_applications_update` is scoped to `app.current_tenant_id()`, which a
 * super admin does not have. So this is the platform's equivalent, and its guard
 * is the whole boundary.
 *
 * THE `tenant_id IS NULL` CHECK IS NOT A FORMALITY. Without it this endpoint
 * would let a platform administrator move a customer's candidate to "rejected"
 * and write notes into their hiring record. A super admin can already READ those
 * rows — the policy allows it and the console deliberately does not show them —
 * but reading someone's data by accident is a mistake, and changing the outcome
 * of their hiring is not a power this role should hold at all.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, applicationReviewSchema)
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('job_applications')
    .select('id, job_id, tenant_id, status')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That application was not found.', 404)
  const row = existing as { id: string; job_id: string; tenant_id: string | null; status: string }

  if (row.tenant_id) {
    return jsonError(
      "This applicant belongs to an organization's hiring process, not the platform's.",
      403
    )
  }

  const patch: Record<string, unknown> = {}
  if (input.status) {
    patch.status = input.status
    patch.reviewed_by = ctx.userId
    patch.reviewed_at = new Date().toISOString()
  }
  if (input.notes !== undefined) patch.org_notes = input.notes

  if (!Object.keys(patch).length) return jsonOk({ ok: true })

  const { error } = await admin.from('job_applications').update(patch).eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.application.reviewed',
    entity: 'job_applications',
    entityId: id,
    meta: { jobId: row.job_id, from: row.status, to: input.status ?? row.status, platform: true },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
