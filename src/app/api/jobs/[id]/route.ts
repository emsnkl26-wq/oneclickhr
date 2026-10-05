/**
 * One posting in full — what "View details" fetches (057).
 *
 * The feed sends card columns only, so the description, responsibilities,
 * requirements, skills and recruiter block arrive from here, for the single
 * posting somebody opened, instead of being shipped twenty at a time on the
 * chance that one of them is.
 *
 * 404 FOR ANYTHING NOT PUBLISHED. `getPublicJob` returns null for "draft",
 * "closed" and "never existed" alike and this route must not distinguish them
 * either — the response for a withdrawn posting has to look exactly like the
 * response for a uuid that was never a job.
 */
import { NextResponse } from 'next/server'
import { getPublicJob } from '@/lib/jobs-public'
import { withErrorHandler, jsonError } from '@/lib/api'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params

    const job = await getPublicJob(id)
    if (!job) return jsonError('This role is no longer available.', 404)

    return NextResponse.json(job, {
      headers: {
        // Public, and the same for everyone. A posting's text changes far less
        // often than the feed it sits in, so it may be held a little longer.
        'Cache-Control': 'public, max-age=0, s-maxage=120, stale-while-revalidate=600',
      },
    })
  }
)
