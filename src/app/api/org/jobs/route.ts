import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { jobSchema } from '@/lib/schemas'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Create a job posting.
 *
 * It starts as a DRAFT, always. `jobSchema` has no `status` field, so there is
 * no body that can bypass this — publishing is a second, deliberate action
 * through PATCH. A posting goes onto a page the whole internet can read, and
 * that should never be something a half-finished form can do by accident.
 *
 * `tenant_id` comes from the session, never the body, and `jobs_write` re-proves
 * it in the database. `department_id` is not re-validated here: RLS on
 * `departments` means a foreign id fails the foreign key rather than silently
 * attaching another tenant's department.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, jobSchema)
  const supabase = await createSupabaseServerClient()

  const { data: job, error } = await supabase
    .from('jobs')
    .insert({
      tenant_id: ctx.tenantId,
      posted_by: ctx.userId,
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
      status: 'draft',
    })
    .select('id')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.created',
    entity: 'jobs',
    entityId: job.id,
    meta: { title: input.title },
    request,
  })

  return jsonOk({ id: job.id }, 201)
}

export const POST = withErrorHandler(handlePOST)
