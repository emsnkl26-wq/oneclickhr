import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk } from '@/lib/api'
import { requireCron } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteObject, listObjects, isR2Configured } from '@/lib/r2'
import { recordCronRun } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Nothing younger than this is touched. See the note below. */
const GRACE_MS = 24 * 60 * 60 * 1000

/** One page per run. A sweep that tries to be exhaustive is a sweep that times out. */
const PAGE_SIZE = 1000

/**
 * Delete uploaded CVs that never became applications. Runs daily.
 *
 * WHY THIS EXISTS. `/api/jobs/resume-presign` is the one write an unauthenticated
 * caller can cause. Someone who attaches a CV and then closes the tab leaves an
 * object nothing references — and unlike every other upload in this product,
 * there is no signed-in user whose account it hangs off and no row that will ever
 * point at it. Without a sweep, the bucket accumulates strangers' personal data
 * forever, which is both a cost and a liability.
 *
 * THE GRACE PERIOD IS THE WHOLE SAFETY ARGUMENT. An object is uploaded BEFORE the
 * application row that references it exists — that is inherent to a presigned
 * upload — so for a few seconds every legitimate CV looks exactly like an orphan.
 * Twenty-four hours is far beyond the widest plausible gap between a browser
 * finishing a PUT and the apply request landing, and it means a slow form, a
 * retried submit or a clock skew cannot cost someone their attachment.
 *
 * FAILS SAFE IN BOTH DIRECTIONS. If the database lookup errors, nothing is
 * deleted this run — an unreadable reference table must never be read as "no
 * references exist". If a delete fails, it is logged and retried tomorrow.
 */
async function handlePOST(request: NextRequest) {
  const denied = await requireCron(request, 'jobs-gc')
  if (denied) return denied

  const startedAt = Date.now()
  const summary = {
    scanned: 0,
    candidates: 0,
    deleted: 0,
    failed: 0,
    errors: [] as string[],
  }

  if (!isR2Configured()) {
    await recordCronRun('jobs-gc', false, Date.now() - startedAt, { reason: 'r2 not configured' })
    return jsonOk({ ok: false, ...summary, reason: 'File storage is not configured' })
  }

  try {
    const cutoff = Date.now() - GRACE_MS
    const { objects } = await listObjects('applications/resumes/', PAGE_SIZE)
    summary.scanned = objects.length

    const stale = objects.filter(
      (obj) => obj.lastModified && obj.lastModified.getTime() < cutoff
    )
    summary.candidates = stale.length

    if (!stale.length) {
      await recordCronRun('jobs-gc', true, Date.now() - startedAt, summary)
      return jsonOk({ ok: true, ...summary })
    }

    /*
     * Ask which of these ARE referenced, then delete the complement.
     *
     * Framed this way round on purpose. The alternative — look each key up and
     * delete the ones that come back empty — turns a failed query into a delete,
     * which is the one outcome that cannot be undone. Here a failure means the
     * `referenced` set is short, and the code below refuses to proceed rather
     * than treating "we could not tell" as "nobody wants it".
     */
    const admin = createAdminClient()
    const keys = stale.map((obj) => obj.key)

    const { data, error } = await admin
      .from('job_applications')
      .select('resume_key')
      .in('resume_key', keys)

    if (error) {
      summary.errors.push(`reference lookup failed: ${error.message}`)
      await recordCronRun('jobs-gc', false, Date.now() - startedAt, summary)
      return jsonOk({ ok: false, ...summary })
    }

    const referenced = new Set(
      ((data ?? []) as Array<{ resume_key: string | null }>)
        .map((row) => row.resume_key)
        .filter((key): key is string => !!key)
    )

    for (const key of keys) {
      if (referenced.has(key)) continue
      try {
        await deleteObject(key)
        summary.deleted += 1
      } catch (err) {
        summary.failed += 1
        summary.errors.push(`${key}: ${(err as Error).message}`)
      }
    }

    await recordCronRun('jobs-gc', true, Date.now() - startedAt, summary)
    return jsonOk({ ok: true, ...summary })
  } catch (err) {
    summary.errors.push((err as Error).message)
    await recordCronRun('jobs-gc', false, Date.now() - startedAt, summary)
    return jsonOk({ ok: false, ...summary })
  }
}

export const POST = withErrorHandler(handlePOST)
