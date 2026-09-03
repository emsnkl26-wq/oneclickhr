import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { resumePresignSchema } from '@/lib/schemas'
import { extensionOf, presignPut, r2ConfigProblem } from '@/lib/r2'
import { isDangerousMime } from '@/lib/upload-policy'
import { rateLimit, limitKey, getClientIp } from '@/lib/rate-limit'
import { getOpenJobForApply } from '@/lib/jobs-public'
import { MAX_RESUME_BYTES, RESUME_EXTENSIONS, resumeKey } from '@/lib/jobs'

export const dynamic = 'force-dynamic'

/**
 * Hand an ANONYMOUS caller a short-lived upload URL for one CV.
 *
 * This is the only write in the product an unauthenticated request can cause, so
 * it is deliberately much narrower than `/api/files/presign`, which it cannot
 * reuse (that route is behind `apiRequireTenantUser` and builds its key from the
 * caller's tenant — an applicant has neither).
 *
 * FIVE THINGS HOLD IT SHUT, and none of them is sufficient alone:
 *
 *   1. A hard per-IP budget. Five an hour is generous for a person applying to
 *      jobs and useless to anyone filling a bucket.
 *   2. The job must EXIST and be PUBLISHED. An upload URL is never minted in the
 *      abstract, only against a real posting someone could actually apply to.
 *   3. One purpose, three extensions, 10MB. Not a general uploader wearing a
 *      different hat.
 *   4. The key is built here, on the server, under `applications/` — a prefix no
 *      tenant owns. See resumeKey() for why that placement is load-bearing.
 *   5. The bytes are re-checked on the way in, at /api/jobs/apply. The signature
 *      authorizes writing one key once; it proves nothing about content, and
 *      `presignPut` does not sign Content-Length, so the size below is a claim
 *      too. Both are settled against the object itself before a row is written.
 *
 * An object uploaded here and never turned into an application is swept by
 * /api/cron/jobs-gc. Nothing else references it, and nothing can read it.
 */
async function handlePOST(request: NextRequest) {
  const problem = r2ConfigProblem()
  if (problem) {
    // Logged with detail, answered without: an anonymous caller gets no
    // inventory of which environment variables this deployment is missing.
    console.error('[jobs/resume-presign] R2 configuration:', problem)
    return jsonError('Uploads are unavailable right now. Please try again later.', 503)
  }

  const limited = await rateLimit(
    limitKey('job-resume', getClientIp(request)),
    5,
    60 * 60 * 1000
  )
  if (!limited.ok) {
    return jsonError('Too many uploads from this connection. Please try again later.', 429)
  }

  const input = await parseBody(request, resumePresignSchema)

  const job = await getOpenJobForApply(input.jobId)
  if (!job) return jsonError('That job is no longer accepting applications.', 404)

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

  const key = resumeKey(ext)

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
