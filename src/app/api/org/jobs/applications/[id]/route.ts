import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { applicationReviewSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Move an application through the pipeline, or leave a note on it.
 *
 * Only four columns are writable, and that is enforced twice over: this handler
 * names them, and the column grant in 015_jobs.sql means `authenticated` holds
 * no privilege on the rest. The second layer is the one that matters — an org
 * that could PATCH `cover_letter` through PostgREST could rewrite what a
 * candidate said about themselves in a record that may later be evidence.
 *
 * `reviewed_by` / `reviewed_at` are stamped from the session on a status change,
 * so "who moved this to rejected, and when" is a fact rather than a note someone
 * remembered to leave.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, applicationReviewSchema)
  const supabase = await createSupabaseServerClient()

  // RLS scopes this to the hiring tenant, so another org's applicant is a 404.
  const { data: existing } = await supabase
    .from('job_applications')
    .select('id, job_id, status, full_name')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That application was not found.', 404)

  const patch: Record<string, unknown> = {}
  if (input.status) {
    patch.status = input.status
    patch.reviewed_by = ctx.userId
    patch.reviewed_at = new Date().toISOString()
  }
  // Compared against undefined, not falsiness: `notes: null` is how the form
  // clears a note, and treating that as "no change" would make it unclearable.
  if (input.notes !== undefined) patch.org_notes = input.notes

  if (!Object.keys(patch).length) return jsonOk({ ok: true })

  const { error } = await supabase.from('job_applications').update(patch).eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.application.reviewed',
    entity: 'job_applications',
    entityId: id,
    /*
     * The applicant's NAME is not recorded. An audit log is read by super admins
     * across every tenant, and there is no reason for a stranger's identity to
     * be legible there — the status transition is the auditable fact.
     */
    meta: { jobId: existing.job_id, from: existing.status, to: input.status ?? existing.status },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
