import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, jsonError } from '@/lib/api'
import { apiRequireUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
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
  // A display name for a file viewed in the browser, so saving it from the PDF
  // viewer gives "Payslip-Jane-August-2026.pdf" rather than the storage uuid.
  const name = new URL(request.url).searchParams.get('name')

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

  /*
   * A CONVERSATION ATTACHMENT IS GATED FOR EVERYBODY, THE ORG INCLUDED.
   *
   * Every other object in the bucket follows the rule below: an org admin may
   * read anything inside its own tenant, because everything else in there is
   * the workspace's own paperwork. Messaging is the one exception, and it has
   * to be, or the privacy guarantee 062 is built on would hold for message
   * TEXT and quietly fail for every photo and voice note in the same thread —
   * which is the half people actually care about.
   *
   * So a `chat-` key is answered by `messagingMayRead` for every role: it asks
   * the database, under RLS, whether a `message_attachments` row the CALLER can
   * select references this key, and `message_attachments_select` resolves to
   * "are you in that conversation?". An administrator who is in the room gets
   * the file; one who is not gets a 404, exactly as a stranger would.
   *
   * The prefix is produced by FOLDERS in /api/files/presign and nowhere else,
   * and that is cross-referenced there. It is matched after the tenant test
   * above, so `..` and absolute keys are already gone.
   */
  if (isChatKey(key, ctx.tenantId)) {
    if (!(await messagingMayRead(key))) return jsonError('Not found', 404)
  } else if (ctx.role !== 'org') {
    // An employee may read only files that are theirs, so ask the database —
    // under RLS — whether any row they can see actually references this key.
    const allowed =
      (await employeeMayRead(key, ctx.userId)) ||
      (await inOwnOnboarding(key, ctx.userId, ctx.tenantId))
    if (!allowed) return jsonError('Not found', 404)
  }

  const url = download
    ? await presignGet(key, SIGNED_URL_TTL_SECONDS, download)
    : name
      ? await presignGet(key, SIGNED_URL_TTL_SECONDS, name, 'inline')
      : await presignGet(key, SIGNED_URL_TTL_SECONDS)

  const response = NextResponse.redirect(url, { status: 302 })
  response.headers.set('Cache-Control', `private, max-age=${REDIRECT_CACHE_SECONDS}`)
  response.headers.set('Vary', 'Cookie')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

/**
 * The folders every conversation attachment is stored under (062).
 *
 * Must agree with FOLDERS in /api/files/presign, which is the only place that
 * ever builds one of these keys. Both sides carry a note pointing at the other,
 * because a rename on one side alone turns a membership-gated file back into an
 * org-readable one without a single test failing.
 */
const CHAT_FOLDERS = ['chat-images', 'chat-voice', 'chat-files']

function isChatKey(key: string, tenantId: string): boolean {
  const rest = key.slice(tenantId.length + 1)
  return CHAT_FOLDERS.some((folder) => rest.startsWith(`${folder}/`))
}

/**
 * Is this key an attachment — or a room's picture — the CALLER may read?
 *
 * Two indexed equalities, asked together, both through the USER-SCOPED client
 * so the answer comes from the policies rather than from this code:
 *
 *   • `message_attachments_select` is `app.can_read_conversation(...)`, which
 *     is membership and nothing else. Role plays no part — see the box at the
 *     call site.
 *   • `conversations_select` additionally admits an org admin to a ROOM it
 *     manages, which is exactly right for a group's avatar: that picture is
 *     part of the metadata an administrator is allowed to see and to change,
 *     and a direct message has no avatar for the arm to reach.
 *
 * A group avatar is uploaded with the same `chat_image` purpose as a photo sent
 * in a thread, so it lands under the same prefix and arrives here. Giving it a
 * folder of its own would have meant a fourth purpose to keep in step across
 * four files, to express a rule this second query already states.
 */
async function messagingMayRead(key: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient()
  const [attachment, room] = await Promise.all([
    supabase.from('message_attachments').select('id').eq('storage_key', key).limit(1).maybeSingle(),
    supabase.from('conversations').select('id').eq('avatar_url', key).limit(1).maybeSingle(),
  ])
  return !!attachment.data || !!room.data
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
   * All six questions at once.
   *
   * They used to run in series with an early return, so the common case — an
   * employee loading a colleague's avatar, which is none of these — paid a
   * sequential round trip per question before answering "no". They are
   * independent single-row index lookups (009_performance.sql adds the indexes
   * for the key columns), so asking them together costs one round trip instead
   * of six and the answer is identical: true if ANY row is visible.
   */
  const [profile, payslip, document, workAuth, tenant, payment] = await Promise.all([
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
    /*
     * The employee's own payment confirmation (026).
     *
     * Needed as its own question because a payment proof deliberately gets NO
     * `documents` row — it is bank evidence, not a workspace document — so the
     * `documents` lookup above can never find it. Without this an employee
     * could upload their confirmation and then be refused when they clicked
     * View on the file they had just supplied.
     */
    supabase
      .from('payment_confirmations')
      .select('id')
      .eq('file_url', key)
      .limit(1)
      .maybeSingle(),
  ])

  return (
    profile.data?.photo_url === key ||
    !!payslip.data ||
    !!document.data ||
    !!workAuth.data ||
    !!tenant.data ||
    !!payment.data
  )
}

/**
 * Is this key one the employee uploaded into their OWN onboarding draft?
 *
 * Draft files (photo, CV, ID proof…) are referenced by nothing else until the
 * org approves the draft, so without this an employee's freshly uploaded photo
 * rendered as a broken image and "View" on their own CV was a 404. The draft
 * table is not readable by employee sessions, so this asks with the admin
 * client — pinned to the caller's own profile id and tenant.
 */
async function inOwnOnboarding(key: string, userId: string, tenantId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('employee_onboarding')
    .select('photo_url, resume_url, offer_letter_url, id_proof_url, auth_document_url, additional_docs')
    .eq('employee_profile_id', userId)
    .eq('tenant_id', tenantId)

  return (data ?? []).some((row) => {
    const r = row as Record<string, unknown>
    if ([r.photo_url, r.resume_url, r.offer_letter_url, r.id_proof_url, r.auth_document_url].includes(key)) {
      return true
    }
    return Array.isArray(r.additional_docs) &&
      (r.additional_docs as Array<{ key?: string }>).some((d) => d?.key === key)
  })
}

export const GET = withErrorHandler(handleGET)
