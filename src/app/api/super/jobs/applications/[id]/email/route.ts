import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailApplicantStatus } from '@/lib/jobs'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const emailSchema = z.object({
  message: z.string().trim().min(1, 'Write a message to the candidate').max(2000),
})

/**
 * Email a candidate for one of OneclickHR's OWN postings at their current stage
 * (011). Mirrors the org route; the `tenant_id IS NULL` check keeps a platform
 * admin out of a customer's hiring correspondence.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const { message } = await parseBody(request, emailSchema)
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('job_applications')
    .select('id, job_id, tenant_id, email')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That application was not found.', 404)
  const row = existing as { id: string; job_id: string; tenant_id: string | null; email: string | null }
  if (row.tenant_id) {
    return jsonError(
      "This applicant belongs to an organization's hiring process, not the platform's.",
      403
    )
  }
  if (!row.email) return jsonError('This candidate has no email address on file.', 400)

  await emailApplicantStatus(admin, id, message)

  await audit({
    tenantId: null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.application.emailed',
    entity: 'job_applications',
    entityId: id,
    meta: { jobId: row.job_id, platform: true },
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
