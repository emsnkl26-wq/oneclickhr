import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireCandidate } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { candidateProfileSchema } from '@/lib/schemas'
import { ownsResumeKey, validateResumeObject } from '@/lib/jobs'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Save a job seeker's own profile (052).
 *
 * Written on the CALLER's session: `candidate_profiles` policies allow only
 * `id = auth.uid()` for an active candidate, and the profile guard stops a
 * self-service edit from touching role, tenant or anything privileged — so the
 * only thing this route decides is the CV.
 *
 * THE CV. A new one must be a key this account uploaded (ownsResumeKey), and
 * its bytes are checked before it is saved. The previous CV is NOT deleted
 * here: applications already sent may point at it, and the nightly sweep
 * removes it once nothing does.
 */
async function handlePATCH(request: NextRequest) {
  const gate = await apiRequireCandidate()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, candidateProfileSchema)
  const supabase = await createSupabaseServerClient()

  const resume: Record<string, string | null> = {}
  if (input.resumeKey) {
    if (!ownsResumeKey(input.resumeKey, ctx.userId)) {
      return jsonError('That file could not be found. Please upload your CV again.', 400)
    }
    const check = await validateResumeObject(input.resumeKey)
    if (!check.ok) return jsonError(check.error, 400)
    resume.resume_key = input.resumeKey
    resume.resume_name = input.resumeName ?? 'CV'
  } else if (input.removeResume) {
    resume.resume_key = null
    resume.resume_name = null
  }

  const { error } = await supabase.from('candidate_profiles').upsert(
    {
      id: ctx.userId,
      headline: input.headline,
      phone: input.phone,
      location: input.location,
      country: input.country,
      linkedin_url: input.linkedinUrl,
      portfolio_url: input.portfolioUrl,
      years_experience: input.yearsExperience,
      current_company: input.currentCompany,
      notice_period: input.noticePeriod,
      work_authorization: input.workAuthorization,
      summary: input.summary,
      skills: Array.from(new Set(input.skills)),
      ...resume,
    },
    { onConflict: 'id' }
  )
  if (error) return jsonError(friendlyDbError(error), 400)

  // The display name lives on the profile, which the guard lets a person edit.
  if (input.fullName !== ctx.fullName) {
    const { error: nameError } = await supabase
      .from('profiles')
      .update({ full_name: input.fullName })
      .eq('id', ctx.userId)
    if (nameError) return jsonError(friendlyDbError(nameError), 400)
  }

  await audit({
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'candidate.profile_updated',
    entity: 'candidate_profiles',
    entityId: ctx.userId,
    meta: { resume: input.resumeKey ? 'replaced' : input.removeResume ? 'removed' : 'unchanged' },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
