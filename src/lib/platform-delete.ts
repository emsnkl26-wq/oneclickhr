import 'server-only'

/**
 * Permanent deletion from the platform console — a whole organization, or one
 * person (053).
 *
 * THE ORDER IS THE SAFETY. Each step is chosen so that stopping half way
 * leaves something that is locked and can simply be retried, never something
 * that half works:
 *
 *   organization
 *     1. (the caller insists the workspace is already SUSPENDED — every
 *        session inside it is refused from that moment)
 *     2. delete every sign-in in it (auth users; profiles cascade from them)
 *     3. purge_tenant() — every tenant-scoped row, in one transaction
 *     4. best-effort: the workspace's files under `<tenantId>/` in R2
 *
 *   person
 *     1. their own applications, onboarding records
 *     2. their sign-in (auth user; profile and personal rows cascade)
 *     3. best-effort: the files that were theirs
 *
 * Storage cleanup comes LAST and never fails the operation: a database without
 * the rows is the deletion; an orphaned object nobody can reference is litter.
 *
 * Everything here uses the service role and is reachable only from
 * super-admin routes, which re-verify the caller's password first.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteObject, listObjects, isR2Configured } from '@/lib/r2'
import { isResumeKey } from '@/lib/jobs'

type Admin = ReturnType<typeof createAdminClient>

/** Delete every object under a prefix, a page at a time, up to a ceiling. */
async function deletePrefix(prefix: string, ceiling = 20_000): Promise<number> {
  if (!isR2Configured()) return 0
  let deleted = 0
  // Always re-list from the start: deleting shifts what the next page holds.
  for (let guard = 0; guard < 100 && deleted < ceiling; guard++) {
    const { objects } = await listObjects(prefix, 1000)
    if (!objects.length) break
    for (const object of objects) {
      await deleteObject(object.key)
      deleted += 1
    }
  }
  return deleted
}

async function deleteKeys(keys: Iterable<string>): Promise<number> {
  if (!isR2Configured()) return 0
  let deleted = 0
  for (const key of new Set(keys)) {
    if (!key || key.includes('..') || key.startsWith('/')) continue
    await deleteObject(key)
    deleted += 1
  }
  return deleted
}

/**
 * Every storage key that belongs to exactly this person — read BEFORE their
 * rows are deleted, since the rows are what name them. Résumés only when
 * nothing else still points at the same object.
 */
async function personalFileKeys(admin: Admin, userId: string, tenantId: string | null) {
  const keys: string[] = []
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) keys.push(value)
  }

  const [profile, docs, auths, payments, payslips, candidate, applications] = await Promise.all([
    admin
      .from('profiles')
      .select('photo_url, resume_url, offer_letter_url, id_proof_url')
      .eq('id', userId)
      .maybeSingle(),
    tenantId
      ? admin.from('documents').select('file_url').eq('tenant_id', tenantId).eq('employee_id', userId)
      : Promise.resolve({ data: [] }),
    tenantId
      ? admin
          .from('work_authorizations')
          .select('document_url')
          .eq('tenant_id', tenantId)
          .eq('employee_id', userId)
      : Promise.resolve({ data: [] }),
    tenantId
      ? admin
          .from('payment_confirmations')
          .select('file_url')
          .eq('tenant_id', tenantId)
          .eq('employee_id', userId)
      : Promise.resolve({ data: [] }),
    tenantId
      ? admin.from('payslips').select('file_url').eq('tenant_id', tenantId).eq('employee_id', userId)
      : Promise.resolve({ data: [] }),
    admin.from('candidate_profiles').select('resume_key').eq('id', userId).maybeSingle(),
    admin.from('job_applications').select('resume_key').eq('applicant_profile_id', userId),
  ])

  const p = profile.data as Record<string, unknown> | null
  if (p) ['photo_url', 'resume_url', 'offer_letter_url', 'id_proof_url'].forEach((k) => add(p[k]))
  for (const row of (docs.data ?? []) as Array<{ file_url: string }>) add(row.file_url)
  for (const row of (auths.data ?? []) as Array<{ document_url: string | null }>) add(row.document_url)
  for (const row of (payments.data ?? []) as Array<{ file_url: string | null }>) add(row.file_url)
  for (const row of (payslips.data ?? []) as Array<{ file_url: string }>) add(row.file_url)

  // Tenant files must actually sit under the tenant's prefix — a stored value
  // that does not is not ours to delete.
  const scoped = tenantId ? keys.filter((k) => k.startsWith(`${tenantId}/`)) : []

  const resumes = [
    (candidate.data as { resume_key: string | null } | null)?.resume_key,
    ...((applications.data ?? []) as Array<{ resume_key: string | null }>).map((r) => r.resume_key),
  ].filter((k): k is string => isResumeKey(k))

  return { tenantKeys: scoped, resumeKeys: Array.from(new Set(resumes)) }
}

export type DeletePersonResult =
  | { ok: true; email: string | null; name: string | null; role: string; filesRemoved: number }
  | { ok: false; error: string; status: number }

/**
 * Delete one employee or job seeker, completely. Organization admins are
 * refused: an owner goes with their organization, and removing a workspace's
 * administrator from outside it is not a platform operator's call.
 */
export async function deletePersonPermanently(userId: string): Promise<DeletePersonResult> {
  const admin = createAdminClient()

  const { data: profile, error: readError } = await admin
    .from('profiles')
    .select('id, role, email, full_name, tenant_id')
    .eq('id', userId)
    .maybeSingle()

  if (readError) return { ok: false, error: 'That account could not be loaded.', status: 500 }
  if (!profile) return { ok: false, error: 'That account was not found.', status: 404 }
  if (profile.role !== 'employee' && profile.role !== 'candidate') {
    return {
      ok: false,
      error:
        profile.role === 'org'
          ? 'Organization administrators are removed with their organization, or by that organization.'
          : 'Platform administrator accounts cannot be deleted here.',
      status: 403,
    }
  }

  const tenantId = (profile.tenant_id as string | null) ?? null
  const files = await personalFileKeys(admin, userId, tenantId)

  // Their own applications (and, by cascade, the history of each).
  const { error: appsError } = await admin
    .from('job_applications')
    .delete()
    .eq('applicant_profile_id', userId)
  if (appsError) {
    console.error('[platform-delete] applications', appsError)
    return { ok: false, error: 'Their job applications could not be removed.', status: 500 }
  }

  if (tenantId) {
    const { error: onboardingError } = await admin
      .from('employee_onboarding')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('employee_profile_id', userId)
    if (onboardingError) {
      console.error('[platform-delete] onboarding', onboardingError)
      return { ok: false, error: 'Their onboarding record could not be removed.', status: 500 }
    }
  }

  const { error: authError } = await admin.auth.admin.deleteUser(userId)
  if (authError) {
    console.error('[platform-delete] auth user', authError)
    return { ok: false, error: 'The account could not be deleted. Please try again.', status: 500 }
  }

  // Résumés only once no remaining row points at them (another application
  // could, in principle, have been sent with the same saved CV).
  let filesRemoved = 0
  try {
    const { data: stillUsed } = files.resumeKeys.length
      ? await admin.from('job_applications').select('resume_key').in('resume_key', files.resumeKeys)
      : { data: [] }
    const used = new Set(((stillUsed ?? []) as Array<{ resume_key: string }>).map((r) => r.resume_key))
    filesRemoved = await deleteKeys([
      ...files.tenantKeys,
      ...files.resumeKeys.filter((k) => !used.has(k)),
    ])
  } catch (err) {
    console.warn('[platform-delete] file cleanup incomplete', err)
  }

  return {
    ok: true,
    email: (profile.email as string | null) ?? null,
    name: (profile.full_name as string | null) ?? null,
    role: profile.role as string,
    filesRemoved,
  }
}

export type PurgeOrgResult =
  | { ok: true; accountsRemoved: number; filesRemoved: number }
  | { ok: false; error: string; status: number; accountsRemoved: number }

/**
 * Delete an organization and everything in it. The caller has already checked
 * that the workspace is suspended and the operator re-entered their password.
 */
export async function purgeOrganization(tenantId: string): Promise<PurgeOrgResult> {
  const admin = createAdminClient()

  const { data: people, error: peopleError } = await admin
    .from('profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(10_000)

  if (peopleError) {
    return { ok: false, error: 'The workspace members could not be loaded.', status: 500, accountsRemoved: 0 }
  }

  let accountsRemoved = 0
  for (const person of (people ?? []) as Array<{ id: string }>) {
    const { error } = await admin.auth.admin.deleteUser(person.id)
    // Already gone is fine — a retry after a partial run hits exactly this.
    if (error && !/not.?found/i.test(error.message)) {
      console.error('[platform-delete] auth user in tenant', tenantId, error)
      return {
        ok: false,
        error: `Stopped after removing ${accountsRemoved} account(s): one sign-in could not be deleted. The organization stays suspended — try again.`,
        status: 500,
        accountsRemoved,
      }
    }
    accountsRemoved += 1
  }

  const { error: purgeError } = await admin.rpc('purge_tenant', { p_tenant: tenantId })
  if (purgeError) {
    console.error('[platform-delete] purge_tenant', tenantId, purgeError)
    return {
      ok: false,
      error: 'The accounts were removed, but the workspace data could not be deleted. It stays suspended — try again.',
      status: 500,
      accountsRemoved,
    }
  }

  let filesRemoved = 0
  try {
    filesRemoved = await deletePrefix(`${tenantId}/`)
  } catch (err) {
    console.warn('[platform-delete] storage cleanup incomplete for tenant', tenantId, err)
  }

  return { ok: true, accountsRemoved, filesRemoved }
}
