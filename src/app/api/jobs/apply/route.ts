import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { jobApplicationSchema } from '@/lib/schemas'
import { rateLimit, limitKey, getClientIp } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { apiRequireUser } from '@/lib/auth/guards'
import { getOpenJobForApply } from '@/lib/jobs-public'
import {
  isExpired, isResumeKey, jobNotificationRecipients, ownsResumeKey, validateResumeObject,
} from '@/lib/jobs'
import { sendApplicationReceived, sendNewApplicationAlert } from '@/lib/email'
import { deleteObject } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Receive one job application.
 *
 * THE ONLY WRITE PATH FOR `job_applications`. That table has no INSERT policy
 * at all (015_jobs.sql), so this handler and the service role are the whole of
 * it — the rate limits, the honeypot and the résumé byte check cannot be
 * expressed as policies.
 *
 * AN ACCOUNT IS REQUIRED (052). A job seeker (`candidate`) or an employee of
 * any workspace may apply; an organization admin or a platform admin may not —
 * they are the people who read applications, not send them. Every application
 * is linked to the applicant's profile, which is what lets them follow it
 * afterwards, and the email on it is the account's own rather than whatever
 * the form said.
 *
 * THE TENANT COMES FROM THE JOB, NEVER THE REQUEST. `tenantId` below is read out
 * of the posting, and it is what decides which org can later see this row. Taking
 * it from the body would let anyone file an application into any org's inbox, and
 * taking it from the applicant's own session would show their current employer
 * that they are job-hunting. See the privacy note in 015_jobs.sql.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireUser()
  if (!gate.ok) {
    return jsonError('Please sign in to apply for jobs.', 401)
  }
  const { ctx } = gate
  if (ctx.role !== 'candidate' && ctx.role !== 'employee') {
    return jsonError(
      'Applications are sent from a job seeker account. Sign in with one to apply.',
      403
    )
  }

  const ip = getClientIp(request)
  const limited = await rateLimit(limitKey('job-apply-ip', ip), 20, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('Too many applications from this connection. Please try again later.', 429)
  }

  const input = await parseBody(request, jobApplicationSchema)

  /*
   * The honeypot, answered with a 200. A script that is told it failed learns
   * which field gave it away; one told it succeeded goes away.
   */
  // Nothing is deleted here: an unreferenced upload is collected by the nightly
  // sweep (/api/cron/jobs-gc), and a key named in this request could be the
  // person's saved profile CV.
  if (input.website && input.website.trim()) {
    return jsonOk({ ok: true })
  }

  const job = await getOpenJobForApply(input.jobId)
  if (!job || isExpired(job.closesAt)) {
    return jsonError('That job is no longer accepting applications.', 404)
  }

  // Per account as well as per connection: one person spraying every posting.
  const perUser = await rateLimit(limitKey('job-apply-user', ctx.userId), 30, 24 * 60 * 60 * 1000)
  if (!perUser.ok) {
    return jsonError('You have applied to a lot of roles today. Please try again tomorrow.', 429)
  }

  const admin = createAdminClient()

  /*
   * THE CV. Either a fresh upload — whose bytes are checked before any row is
   * written, and deleted if they are not a real CV — or the one saved on the
   * candidate's own profile, read by THEIR id so nobody can attach somebody
   * else's file by naming its key.
   */
  let resumeKey: string | null = null
  let resumeName: string | null = null
  // True only for a CV uploaded for THIS application — the one thing a failed
  // insert may clean up. The saved profile CV is never deleted from here.
  let freshUpload = false
  if (input.resumeKey) {
    // Only a file THIS account uploaded — see ownsResumeKey().
    if (!ownsResumeKey(input.resumeKey, ctx.userId)) {
      return jsonError('That file could not be found. Please attach your CV again.', 400)
    }
    const { data: saved } = await admin
      .from('candidate_profiles')
      .select('resume_key')
      .eq('id', ctx.userId)
      .maybeSingle()
    freshUpload = (saved as { resume_key: string | null } | null)?.resume_key !== input.resumeKey
    if (freshUpload) {
      const check = await validateResumeObject(input.resumeKey)
      if (!check.ok) return jsonError(check.error, 400)
    }
    resumeKey = input.resumeKey
    resumeName = input.resumeName
  } else if (input.useSavedResume) {
    if (ctx.role !== 'candidate') {
      return jsonError('Attach your CV to apply.', 400)
    }
    const { data: saved } = await admin
      .from('candidate_profiles')
      .select('resume_key, resume_name')
      .eq('id', ctx.userId)
      .maybeSingle()
    const row = saved as { resume_key: string | null; resume_name: string | null } | null
    if (!row?.resume_key || !isResumeKey(row.resume_key)) {
      return jsonError('There is no CV saved on your profile. Attach one to apply.', 400)
    }
    resumeKey = row.resume_key
    resumeName = row.resume_name
  }

  const { data, error } = await admin
    .from('job_applications')
    .insert({
      job_id: job.id,
      tenant_id: job.tenantId,
      full_name: input.fullName,
      email: ctx.email,
      phone: input.phone,
      location: input.location,
      linkedin_url: input.linkedinUrl,
      portfolio_url: input.portfolioUrl,
      cover_letter: input.coverLetter,
      resume_key: resumeKey,
      resume_name: resumeName,
      years_experience: input.yearsExperience,
      current_company: input.currentCompany,
      notice_period: input.noticePeriod,
      applicant_profile_id: ctx.userId,
      source: ctx.role === 'employee' ? 'internal' : 'public',
    })
    .select('id')
    .single()

  if (error) {
    // 23505 is the (job_id, lower(email)) index.
    if (error.code === '23505') {
      return jsonError('You have already applied to this role.', 409)
    }
    console.error('[jobs/apply] insert failed', error.code, error.message)
    // Only a FRESH upload is ours to clean up — never the saved profile CV.
    if (freshUpload && resumeKey) {
      await deleteObject(resumeKey).catch(() => undefined)
    }
    return jsonError('We could not submit your application. Please try again.', 500)
  }

  const applicationId = (data as { id: string }).id

  await notify(job, input.fullName, ctx.email, applicationId)

  await audit({
    tenantId: job.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'job.application.received',
    entity: 'job_applications',
    entityId: applicationId,
    meta: { jobId: job.id, source: ctx.role === 'employee' ? 'internal' : 'public' },
    request,
  })

  return jsonOk({ id: applicationId }, 201)
}

/**
 * Tell the applicant and the org.
 *
 * Every failure here is swallowed. The application is already committed, and an
 * outage at the mail provider must never turn into a 500 that tells a candidate
 * their submission failed — they would send it again, and the unique index would
 * then tell them they had already applied.
 */
async function notify(
  job: { id: string; title: string; tenantId: string | null },
  applicantName: string,
  applicantEmail: string,
  applicationId: string
): Promise<void> {
  try {
    const admin = createAdminClient()

    let companyName = 'Oneclickhr'
    let brandColor: string | undefined
    if (job.tenantId) {
      const { data } = await admin
        .from('tenants')
        .select('name, primary_color')
        .eq('id', job.tenantId)
        .maybeSingle()
      const tenant = data as { name: string; primary_color: string } | null
      if (tenant) {
        companyName = tenant.name
        brandColor = tenant.primary_color
      }
    }

    const recipients = await jobNotificationRecipients(admin, job.tenantId)

    await Promise.all([
      sendApplicationReceived({
        to: applicantEmail,
        applicantName,
        jobTitle: job.title,
        companyName,
        brandColor,
      }),
      recipients.length
        ? sendNewApplicationAlert({
            to: recipients,
            applicantName,
            jobTitle: job.title,
            jobId: job.id,
            reviewPath: job.tenantId
              ? `/org/jobs/${job.id}?application=${applicationId}`
              : `/super/jobs/${job.id}?application=${applicationId}`,
            orgName: companyName,
            brandColor,
          })
        : Promise.resolve(null),
    ])
  } catch (err) {
    console.error('[jobs/apply] notification failed', err)
  }
}

export const POST = withErrorHandler(handlePOST)
