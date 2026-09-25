import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { resumePresignSchema } from '@/lib/schemas'
import { extensionOf, presignPut, r2ConfigProblem } from '@/lib/r2'
import { isDangerousMime } from '@/lib/upload-policy'
import { rateLimit, limitKey, getClientIp } from '@/lib/rate-limit'
import { apiRequireUser } from '@/lib/auth/guards'
import { getOpenJobForApply } from '@/lib/jobs-public'
import { MAX_RESUME_BYTES, RESUME_EXTENSIONS, resumeKey } from '@/lib/jobs'

export const dynamic = 'force-dynamic'

/**
 * Hand a signed-in applicant a short-lived upload URL for one CV.
 *
 * Deliberately much narrower than `/api/files/presign`, which it cannot reuse
 * (that route builds its key from the caller's TENANT, and a job seeker has
 * none). Since 052 it needs an account, like applying does.
 *
 * WHAT HOLDS IT SHUT:
 *
 *   1. A signed-in job seeker or employee, and a per-account AND per-IP budget.
 *   2. Against a job: it must EXIST and be PUBLISHED. Without one (`jobId`
 *      omitted), only a job seeker saving the CV on their own profile.
 *   3. One purpose, three extensions, 10MB.
 *   4. The key is built here, under `applications/` — a prefix no tenant owns —
 *      and namespaced by the uploader, so only they can later attach it. See
 *      resumeKey() / ownsResumeKey().
 *   5. The bytes are re-checked when the key is used (apply, or profile save).
 *      The signature authorizes writing one key once; it proves nothing about
 *      content, and `presignPut` does not sign Content-Length.
 *
 * An object uploaded here and never used is swept by /api/cron/jobs-gc.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireUser()
  if (!gate.ok) return jsonError('Please sign in to upload your CV.', 401)
  const { ctx } = gate
  if (ctx.role !== 'candidate' && ctx.role !== 'employee') {
    return jsonError('CV uploads are for job seeker accounts.', 403)
  }

  const problem = r2ConfigProblem()
  if (problem) {
    console.error('[jobs/resume-presign] R2 configuration:', problem)
    return jsonError('Uploads are unavailable right now. Please try again later.', 503)
  }

  const [byIp, byUser] = await Promise.all([
    rateLimit(limitKey('job-resume', getClientIp(request)), 20, 60 * 60 * 1000),
    rateLimit(limitKey('job-resume-user', ctx.userId), 10, 60 * 60 * 1000),
  ])
  if (!byIp.ok || !byUser.ok) {
    return jsonError('Too many uploads. Please try again later.', 429)
  }

  const input = await parseBody(request, resumePresignSchema)

  if (input.jobId) {
    const job = await getOpenJobForApply(input.jobId)
    if (!job) return jsonError('That job is no longer accepting applications.', 404)
  } else if (ctx.role !== 'candidate') {
    return jsonError('Choose the job you are applying to.', 400)
  }

  if (input.sizeBytes > MAX_RESUME_BYTES) {
    return jsonError('Keep your CV under 10MB.', 400)
  }
  if (isDangerousMime(input.contentType)) {
    return jsonError('Please attach your CV as a PDF or Word document.', 400)
  }

  const ext = extensionOf(input.fileName)
  if (!RESUME_EXTENSIONS.has(ext)) {
    return jsonError('Please attach your CV as a PDF or Word document.', 400)
  }

  const key = resumeKey(ext, ctx.userId)

  let url: string
  try {
    url = await presignPut(key, input.contentType)
  } catch (err) {
    console.error('[jobs/resume-presign] could not sign an upload url', err)
    return jsonError('Uploads are unavailable right now. Please try again later.', 503)
  }

  return jsonOk({ url, key })
}

export const POST = withErrorHandler(handlePOST)
