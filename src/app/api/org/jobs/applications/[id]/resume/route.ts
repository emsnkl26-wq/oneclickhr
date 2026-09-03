import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, jsonError, uuidSchema } from '@/lib/api'
import { apiRequireUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { presignGet } from '@/lib/r2'
import { isResumeKey } from '@/lib/jobs'

export const dynamic = 'force-dynamic'

/** Signature lifetime. */
const SIGNED_URL_TTL_SECONDS = 15 * 60

/**
 * The ONLY way a CV is ever read.
 *
 * `/api/files/view` cannot serve these and never will: résumés live under the
 * `applications/` prefix, and that route's first check is that a key starts with
 * the caller's own tenant uuid. `applications` is not a uuid, so the check fails
 * for every tenant that will ever exist. See resumeKey() in src/lib/jobs.ts.
 *
 * That leaves this route as the whole of the authorization, and it is deliberately
 * addressed by APPLICATION ID rather than by key. A caller cannot name an object;
 * they can only name a row, and RLS decides whether they may see that row. So the
 * question "may I read this file?" is answered by `job_applications_select` — the
 * hiring org, or a super admin — rather than by anything written here.
 *
 * No caching header, unlike /api/files/view. That route caches because it serves
 * hundreds of avatars per page; this one serves a single document that a person
 * opened on purpose, and a stranger's CV is not a thing to leave sitting in a
 * browser cache for the next person at that desk.
 */
async function handleGET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await apiRequireUser()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  /*
   * An employee has no business here even though the policy would let them read
   * their OWN application row. They already know what they attached, and letting
   * this route serve them means one more path that reaches into the résumé
   * prefix. Reviewing is the org's job and the super admin's.
   */
  if (ctx.role !== 'org' && ctx.role !== 'super_admin') {
    return jsonError('Not found', 404)
  }

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('job_applications')
    .select('resume_key, resume_name, full_name')
    .eq('id', id)
    .maybeSingle()

  const row = data as { resume_key: string | null; resume_name: string | null; full_name: string } | null

  // One answer for "no such row", "not yours" and "no CV attached". Telling them
  // apart would confirm the existence of applications the caller cannot see.
  if (!row?.resume_key || !isResumeKey(row.resume_key)) {
    return jsonError('Not found', 404)
  }

  // Downloaded under the applicant's name rather than a uuid — a reviewer saving
  // three CVs should not end up with three files they cannot tell apart.
  const ext = row.resume_key.split('.').pop() || 'pdf'
  const safeName = row.full_name.replace(/[^\w\s.-]/g, '').trim() || 'resume'
  const filename = row.resume_name || `${safeName}.${ext}`

  const url = await presignGet(row.resume_key, SIGNED_URL_TTL_SECONDS, filename)

  const response = NextResponse.redirect(url, { status: 302 })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

export const GET = withErrorHandler(handleGET)
