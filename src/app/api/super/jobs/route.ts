import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { jobSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Post one of Oneclickhr's own openings.
 *
 * Written with the SERVICE ROLE, not the session client, and that is not a
 * shortcut. A super admin's RLS bypass in this codebase is read-only — every
 * write policy in the schema is scoped to `app.current_tenant_id()`, and a super
 * admin has no tenant by design (see the profiles constraint in 001). So
 * `jobs_write` refuses this insert no matter who is signed in, exactly as it
 * refuses every other cross-tenant write. The guard above is the boundary.
 *
 * `tenant_id` is left NULL, which is what makes this a platform job. The portal
 * badges those as Oneclickhr; `jobs_tenant_posted_ck` insists on a `posted_by`
 * in exchange, so a platform posting is never unattributable.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, jobSchema)
  const admin = createAdminClient()

  const { data: job, error } = await admin
    .from('jobs')
    .insert({
      tenant_id: null,
      posted_by: ctx.userId,
      title: input.title,
      description: input.description,
      responsibilities: input.responsibilities,
      requirements: input.requirements,
      // A platform job has no tenant, so it cannot borrow a tenant's department.
      department_id: null,
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
      status: 'draft',
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.created',
    entity: 'jobs',
    entityId: job.id,
    meta: { title: input.title, platform: true },
    request,
  })

  return jsonOk({ id: job.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
