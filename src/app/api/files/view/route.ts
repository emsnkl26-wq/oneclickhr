import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, jsonError } from '@/lib/api'
import { apiRequireUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { keyBelongsToTenant, presignGet } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/**
 * The ONLY way a stored file is ever read.
 *
 * The bucket is private, so there is no URL anyone can share, bookmark or find.
 * This route re-verifies the caller, proves the object belongs to their tenant,
 * checks the row-level rule for that KIND of file, then 302s to a signed URL
 * that expires in minutes.
 *
 * Redirecting rather than streaming means the bytes go browser↔R2 directly — an
 * `<img src>` follows the redirect transparently, and a 25MB PDF never passes
 * through a lambda.
 *
 * CACHING. This is the most-requested authenticated route in the product: a
 * table of two hundred employees is two hundred calls to it, each one a session
 * verification plus up to five authorization queries plus a signature — and
 * with `no-store` the browser repeated every one of them on the next page view,
 * and again on the one after that.
 *
 * The redirect is now cached PRIVATELY for a little less than the signature's
 * own lifetime. Three properties make that safe, and all three matter:
 *
 *   • `private` — only the requesting browser may store it. A shared proxy
 *     holding a signed URL would outlive the authorization check that minted it,
 *     which is exactly the hole `no-store` was closing.
 *   • The window is SHORTER than the signature, so a cached redirect can never
 *     point at an expired URL.
 *   • `Vary: Cookie` — sign out, or sign in as someone else, and the cache key
 *     changes with the session cookie rather than serving the previous user's
 *     entry.
 *
 * Revocation is bounded by that window: a file unshared in the next few minutes
 * stays reachable to a browser that already holds the redirect. That is already
 * true of the signed URL itself, so the caching adds no exposure the presign
 * did not.
 */

/** Signature lifetime. */
const SIGNED_URL_TTL_SECONDS = 15 * 60
/** How long a browser may reuse the redirect. Deliberately below the TTL. */
const REDIRECT_CACHE_SECONDS = 10 * 60
async function handleGET(request: NextRequest) {
  const gate = await apiRequireUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const key = new URL(request.url).searchParams.get('key')
  const download = new URL(request.url).searchParams.get('download')

  if (!key) return jsonError('Missing file reference', 400)

  /*
   * Tenant prefix check FIRST. This is the cheap, unbypassable half: a key that
   * does not start with the caller's own tenant uuid is rejected before any
   * query runs. It also kills traversal attempts, since `..` can never appear in
   * a key that literally begins with the caller's tenant id.
   *
   * A super admin has no tenant, and is deliberately NOT given a bypass here.
   * Platform oversight covers metrics and account state, not reading customers'
   * payslips and visa documents.
   */
  if (!ctx.tenantId || !keyBelongsToTenant(key, ctx.tenantId)) {
    return jsonError('Not found', 404)
  }

  // An org may read anything in its own tenant. An employee may read only files
  // that are theirs, so ask the database — under RLS — whether any row they can
  // see actually references this key.
  if (ctx.role !== 'org') {
    const allowed = await employeeMayRead(key, ctx.userId)
    if (!allowed) return jsonError('Not found', 404)
  }

  const url = await presignGet(key, SIGNED_URL_TTL_SECONDS, download ? download : undefined)

  const response = NextResponse.redirect(url, { status: 302 })
  response.headers.set('Cache-Control', `private, max-age=${REDIRECT_CACHE_SECONDS}`)
  response.headers.set('Vary', 'Cookie')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

/**
 * Does a row this employee is allowed to SELECT reference this key?
 *
 * Every query below runs through the USER-SCOPED client, so RLS answers the
 * question — this code never decides who owns what, it only asks. If the
 * policies say an employee sees only their own payslips, then a payslip key
 * belonging to a colleague simply returns no rows.
 */
async function employeeMayRead(key: string, userId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient()

  /*
   * All five questions at once.
   *
   * They used to run in series with an early return, so the common case — an
   * employee loading a colleague's avatar, which is none of these — paid five
   * sequential round trips before answering "no". They are independent
   * single-row index lookups (009_performance.sql adds the indexes for the four
   * key columns), so asking them together costs one round trip instead of five
   * and the answer is identical: true if ANY row is visible.
   */
  const [profile, payslip, document, workAuth, tenant] = await Promise.all([
    supabase.from('profiles').select('photo_url').eq('id', userId).maybeSingle(),
    supabase.from('payslips').select('id').eq('file_url', key).limit(1).maybeSingle(),
    supabase.from('documents').select('id').eq('file_url', key).limit(1).maybeSingle(),
    supabase
      .from('work_authorizations')
      .select('id')
      .eq('document_url', key)
      .limit(1)
      .maybeSingle(),
    // Branding is visible to everyone inside the workspace.
    supabase.from('tenants').select('id').eq('logo_url', key).limit(1).maybeSingle(),
  ])

  return (
    profile.data?.photo_url === key ||
    !!payslip.data ||
    !!document.data ||
    !!workAuth.data ||
    !!tenant.data
  )
}

export const GET = withErrorHandler(handleGET)
