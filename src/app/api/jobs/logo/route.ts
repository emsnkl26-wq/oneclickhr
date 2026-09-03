import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, jsonError, uuidSchema } from '@/lib/api'
import { presignGet } from '@/lib/r2'
import { getAdvertisingCompanyLogo } from '@/lib/jobs-public'

export const dynamic = 'force-dynamic'

/** Signature lifetime. */
const SIGNED_URL_TTL_SECONDS = 15 * 60
/** How long a browser may reuse the redirect. Deliberately below the TTL. */
const REDIRECT_CACHE_SECONDS = 10 * 60

/**
 * A company's logo, for the public portal only.
 *
 * `/api/files/view` cannot serve this: it requires a session, and the whole
 * point of the portal is visitors who have none. So this is a second, much
 * narrower door — one object type, no key parameter, and an authorization rule
 * that is a fact about the tenant rather than about the caller.
 *
 * THE RULE: the tenant must currently have at least one PUBLISHED job. Without
 * it this route would answer "is this uuid a customer of Oneclickhr?" for any
 * uuid anyone cared to try, and hand over their branding. With it, the only
 * thing it confirms is something the same visitor can already read off /jobs.
 *
 * `public` caching rather than `private`, unlike /api/files/view — there is no
 * session in the request, so there is nothing for a shared proxy to leak, and
 * these are the images on a page built to be crawled and linked.
 */
async function handleGET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get('tenant')
  if (!raw) return jsonError('Not found', 404)

  const parsed = uuidSchema.safeParse(raw)
  if (!parsed.success) return jsonError('Not found', 404)

  const key = await getAdvertisingCompanyLogo(parsed.data)
  // Covers "no logo", "not advertising" and "no such tenant" with one answer.
  // Telling them apart is exactly the enumeration this route must not offer.
  if (!key) return jsonError('Not found', 404)

  const url = await presignGet(key, SIGNED_URL_TTL_SECONDS)

  const response = NextResponse.redirect(url, { status: 302 })
  response.headers.set('Cache-Control', `public, max-age=${REDIRECT_CACHE_SECONDS}`)
  return response
}

export const GET = withErrorHandler(handleGET)
