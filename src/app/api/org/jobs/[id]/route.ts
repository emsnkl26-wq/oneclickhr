import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { jobSchema, jobStatusSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * One request shape for two different edits.
 *
 * A status change ({ status }) and a content edit (the whole form) arrive at the
 * same endpoint because they are the same resource, but they are validated
 * separately: publishing must not require re-sending a description, and saving a
 * description must not be able to publish. The discriminator is simply which
 * keys are present.
 */
const statusOnly = jobStatusSchema.strict()

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  // RLS scopes this to the tenant, so another org's job is simply a 404.
  const { data: existing } = await supabase
    .from('jobs')
    .select('id, title, status')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That job was not found.', 404)

  const raw = await request.clone().json().catch(() => null)
  const isStatusChange = statusOnly.safeParse(raw).success

  if (isStatusChange) {
    const { status } = await parseBody(request, jobStatusSchema)

    /*
     * `published_at` is deliberately NOT touched here. The database sets it once,
     * the first time a job goes live, and keeps it — so an org that closes a role
     * and reopens it a week later keeps its original posting date instead of
     * jumping back to the top of the public feed. See tg_jobs_published_at.
     */
    const { error } = await supabase.from('jobs').update({ status }).eq('id', id)
    if (error) return jsonError(friendlyDbError(error), 400)

    await audit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: `job.${status}`,
      entity: 'jobs',
      entityId: id,
      meta: { title: existing.title, from: existing.status },
      request,
    })

    return jsonOk({ ok: true })
  }

  const input = await parseBody(request, jobSchema)

  const { error } = await supabase
    .from('jobs')
    .update({
      title: input.title,
      description: input.description,
      responsibilities: input.responsibilities,
      requirements: input.requirements,
      department_id: input.departmentId ?? null,
      employment_type: input.employmentType,
      workplace: input.workplace,
      location: input.location,
      experience_min: input.experienceMin,
      experience_max: input.experienceMax,
      salary_min: input.salaryMin,
      salary_max: input.salaryMax,
      salary_currency: input.salaryCurrency,
      salary_period: input.salaryPeriod,
      salary_disclosed: input.salaryDisclosed,
      openings: input.openings,
      skills: input.skills,
      closes_at: input.closesAt ?? null,
    })
    .eq('id', id)

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.updated',
    entity: 'jobs',
    entityId: id,
    meta: { title: input.title },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete a job posting.
 *
 * Refused once anyone has applied. `job_applications.job_id` is ON DELETE
 * CASCADE, so this would take real people's applications — and their CVs' only
 * reference — with it, silently and unrecoverably. An org that wants the role
 * off the portal closes it, which is what the status is for.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('jobs')
    .select('id, title, application_count')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That job was not found.', 404)

  if (existing.application_count > 0) {
    return jsonError(
      'People have applied for this role, so it cannot be deleted. Close it instead.',
      409
    )
  }

  const { error } = await supabase.from('jobs').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.deleted',
    entity: 'jobs',
    entityId: id,
    meta: { title: existing.title },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
