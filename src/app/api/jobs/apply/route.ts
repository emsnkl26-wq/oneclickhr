import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { jobApplicationSchema } from '@/lib/schemas'
import { rateLimit, limitKey, getClientIp } from '@/lib/rate-limit'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadContext } from '@/lib/auth/context'
import { getOpenJobForApply } from '@/lib/jobs-public'
import { isExpired, jobNotificationRecipients, validateResumeObject } from '@/lib/jobs'
import { sendApplicationReceived, sendNewApplicationAlert } from '@/lib/email'
import { deleteObject } from '@/lib/r2'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Receive one job application.
 *
 * THE ONLY WRITE PATH FOR `job_applications`, for both anonymous applicants and
 * signed-in employees. That table has no INSERT policy at all (015_jobs.sql), so
 * this handler and the service role are the whole of it — which is the point:
 * the honeypot, the rate limit and the résumé byte check cannot be expressed as
 * policies, and splitting the flow in two would mean two places to keep in step.
 *
 * `loadContext()` rather than a guard. A signed-in employee gets their
 * application linked to their profile so they can see it again later; a
 * signed-out visitor gets exactly the same treatment minus the link. Nobody is
 * turned away for lacking a session — that is the entire feature.
 *
 * THE TENANT COMES FROM THE JOB, NEVER THE REQUEST. `tenantId` below is read out
 * of the posting, and it is what decides which org can later see this row. Taking
 * it from the body would let anyone file an application into any org's inbox, and
 * taking it from the applicant's own session would show their current employer
 * that they are job-hunting. See the privacy note in 015_jobs.sql.
 */
async function handlePOST(request: NextRequest) {
  const ip = getClientIp(request)

  const limited = await rateLimit(limitKey('job-apply-ip', ip), 10, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('Too many applications from this connection. Please try again later.', 429)
  }

  const input = await parseBody(request, jobApplicationSchema)

  /*
   * The honeypot, answered with a 200 and a cheerful body.
   *
   * A bot that is told it failed learns which field gave it away and comes back
   * without it. A bot that is told it succeeded goes away. The résumé object is
   * dropped rather than left for the sweep, since we already know no row will
   * ever reference it.
   */
  if (input.website && input.website.trim()) {
    if (input.resumeKey) {
      await deleteObject(input.resumeKey).catch(() => undefined)
    }
    return jsonOk({ ok: true })
  }

  const job = await getOpenJobForApply(input.jobId)
  if (!job || isExpired(job.closesAt)) {
    return jsonError('That job is no longer accepting applications.', 404)
  }

  // A second budget, per address rather than per connection. The unique index on
  // (job_id, lower(email)) already blocks a duplicate for THIS role; this stops
  // one address spraying every posting on the portal.
  const perEmail = await rateLimit(limitKey('job-apply-email', input.email), 20, 24 * 60 * 60 * 1000)
  if (!perEmail.ok) {
    return jsonError('You have applied to a lot of roles today. Please try again tomorrow.', 429)
  }

  /*
   * The bytes, before the row.
   *
   * The presign step checked what the browser CLAIMED. This checks what actually
   * landed, and deletes it if it is not a real CV. Doing it before the insert
   * means a rejected upload never leaves a half-application behind.
   */
  if (input.resumeKey) {
    const check = await validateResumeObject(input.resumeKey)
    if (!check.ok) return jsonError(check.error, 400)
  }

  // Opportunistic, never required. An employee applying from inside the product
  // gets the row linked to them; everyone else is `source: 'public'`.
  const ctx = await loadContext()
  const applicantProfileId = ctx && ctx.role !== 'super_admin' ? ctx.userId : null

  const admin = createAdminClient()

  const { data, error } = await admin
    .from('job_applications')
    .insert({
      job_id: job.id,
      tenant_id: job.tenantId,
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      location: input.location,
      linkedin_url: input.linkedinUrl,
      portfolio_url: input.portfolioUrl,
      cover_letter: input.coverLetter,
      resume_key: input.resumeKey,
      resume_name: input.resumeName,
      years_experience: input.yearsExperience,
      current_company: input.currentCompany,
      notice_period: input.noticePeriod,
      applicant_profile_id: applicantProfileId,
      source: applicantProfileId ? 'internal' : 'public',
    })
    .select('id')
    .single()

  if (error) {
    // 23505 is the (job_id, lower(email)) index. Worth its own sentence: the
    // generic "that already exists" leaves someone wondering what did.
    if (error.code === '23505') {
      return jsonError('You have already applied to this role.', 409)
    }
    console.error('[jobs/apply] insert failed', error.code, error.message)
    if (input.resumeKey) await deleteObject(input.resumeKey).catch(() => undefined)
    return jsonError('We could not submit your application. Please try again.', 500)
  }

  const applicationId = (data as { id: string }).id

  await notify(job, input.fullName, input.email, applicationId)

  await audit({
    tenantId: job.tenantId,
    // No actor for an anonymous applicant, deliberately: an audit row that
    // invented one would be worse than an honest null.
    actorId: applicantProfileId,
    actorEmail: applicantProfileId ? (ctx?.email ?? null) : null,
    action: 'job.application.received',
    entity: 'job_applications',
    entityId: applicationId,
    meta: { jobId: job.id, source: applicantProfileId ? 'internal' : 'public' },
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
