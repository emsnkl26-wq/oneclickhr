import { NextRequest } from 'next/server'
import { z } from 'zod'
import { withErrorHandler, parseBody, jsonOk, jsonError, uuidSchema } from '@/lib/api'
import { apiRequireJobsManager } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emailApplicantStatus } from '@/lib/jobs'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const emailSchema = z.object({
  // The message the candidate reads — the invitation, offer wording, or a note.
  message: z.string().trim().min(1, 'Write a message to the candidate').max(2000),
})

/**
 * Email a candidate at their CURRENT stage, without moving them (011).
 *
 * This is the "email this person directly" action on the applicant list — a
 * recruiter shortlists someone and sends an invitation or offer straight away.
 * The email states the current stage and carries this message, and it reaches
 * website candidates who applied without an account too.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireJobsManager()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const { message } = await parseBody(request, emailSchema)
  const supabase = await createSupabaseServerClient()

  // RLS scopes this to the hiring tenant, so another org's applicant is a 404.
  const { data: existing } = await supabase
    .from('job_applications')
    .select('id, job_id, email')
    .eq('id', id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()

  if (!existing) return jsonError('That application was not found.', 404)
  if (!existing.email) return jsonError('This candidate has no email address on file.', 400)

  await emailApplicantStatus(createAdminClient(), id, message)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.application.emailed',
    entity: 'job_applications',
    entityId: id,
    meta: { jobId: existing.job_id },
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
