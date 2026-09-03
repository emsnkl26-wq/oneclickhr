import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobSchema, jobStatusSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const statusOnly = jobStatusSchema.strict()

/**
 * THE KILL SWITCH, and a platform job's ordinary editor.
 *
 * A status change applies to ANY job on the platform, including a customer's.
 * That is the whole point of it: this portal carries Oneclickhr's name, and a
 * posting that is fraudulent, discriminatory or simply nonsense has to be
 * removable without waiting for the org that wrote it. Content edits are
 * restricted to platform jobs — taking a role down is moderation; rewriting
 * somebody's advert for them is not.
 *
 * Unpublishing a customer's job leaves a `job.unpublished` audit row naming the
 * super admin who did it. An org whose posting disappears deserves an answer,
 * and this is where it comes from.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('jobs')
    .select('id, tenant_id, title, status')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That job was not found.', 404)
  const job = existing as { id: string; tenant_id: string | null; title: string; status: string }

  const raw = await request.clone().json().catch(() => null)

  if (statusOnly.safeParse(raw).success) {
    const { status } = await parseBody(request, jobStatusSchema)

    const { error } = await admin.from('jobs').update({ status }).eq('id', id)
    if (error) return jsonError(friendlyDbError(error), 400)

    await audit({
      // Recorded against the OWNING tenant, not the platform, so it shows up in
      // that org's own history rather than only in a console they cannot read.
      tenantId: job.tenant_id,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: status === 'published' ? 'job.published' : 'job.unpublished',
      entity: 'jobs',
      entityId: id,
      meta: { title: job.title, from: job.status, by: 'platform' },
      request,
    })

    return jsonOk({ ok: true })
  }

  if (job.tenant_id) {
    return jsonError(
      "This job belongs to an organization. You can unpublish it, but its content is theirs to edit.",
      403
    )
  }

  const input = await parseBody(request, jobSchema)

  const { error } = await admin
    .from('jobs')
    .update({
      title: input.title,
      description: input.description,
      responsibilities: input.responsibilities,
      requirements: input.requirements,
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
    tenantId: null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.updated',
    entity: 'jobs',
    entityId: id,
    meta: { title: input.title, platform: true },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Delete a PLATFORM job only.
 *
 * A customer's posting is never deleted from here, even when it has no
 * applicants. Unpublishing already achieves everything moderation needs, and it
 * leaves the org their own record of what they wrote; deleting it would remove
 * evidence from the only party with a reason to dispute the decision.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('jobs')
    .select('id, tenant_id, title, application_count')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That job was not found.', 404)
  const job = existing as {
    id: string
    tenant_id: string | null
    title: string
    application_count: number
  }

  if (job.tenant_id) {
    return jsonError(
      "This job belongs to an organization. Unpublish it instead — deleting it would take their record with it.",
      403
    )
  }

  if (job.application_count > 0) {
    return jsonError(
      'People have applied for this role, so it cannot be deleted. Close it instead.',
      409
    )
  }

  const { error } = await admin.from('jobs').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.deleted',
    entity: 'jobs',
    entityId: id,
    meta: { title: job.title, platform: true },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
