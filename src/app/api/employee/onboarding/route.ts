import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { onboardingDraftSchema } from '@/lib/schemas'
import { employeeToColumns, OnboardingPatchError } from '@/lib/onboarding-server'
import { keyBelongsToTenant } from '@/lib/r2'

export const dynamic = 'force-dynamic'

/** Every storage key a draft can carry, for the ownership re-check below. */
function keysIn(input: Record<string, unknown>): string[] {
  const single = ['authDocumentUrl', 'photoUrl', 'resumeUrl', 'offerLetterUrl', 'idProofUrl']
  const keys = single.map((k) => input[k]).filter((v): v is string => typeof v === 'string' && !!v)
  const docs = input.additionalDocs
  if (Array.isArray(docs)) {
    for (const doc of docs) {
      if (doc && typeof doc.key === 'string') keys.push(doc.key)
    }
  }
  return keys
}

/**
 * An employee saving THEIR OWN onboarding details.
 *
 * The mirror of `/api/org/onboarding/[id]` — the autosave, the step change and
 * "save and finish later" all land here — with three differences that matter:
 *
 *   1. THERE IS NO ID IN THE URL. The row is found by
 *      `employee_profile_id = <the caller>`, so there is no identifier to
 *      tamper with and no way to address a colleague's draft.
 *   2. `employeeToColumns` narrows the patch to the fields this person is shown
 *      (`EMPLOYEE_STEPS`). Pay, department, hire date and the admin-only notes
 *      are dropped rather than rejected: a stale tab posting a field it no
 *      longer owns should save the rest of the form, not fail it.
 *   3. Only `invited` accepts writes. Once submitted the form is the org's to
 *      review, and an employee editing underneath a reviewer is how the two end
 *      up disagreeing about what was approved.
 */
async function handlePATCH(request: NextRequest) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const input = await parseBody(request, onboardingDraftSchema)

  // Storage keys arrive from the client, so re-prove each one is ours.
  for (const key of keysIn(input as unknown as Record<string, unknown>)) {
    if (!keyBelongsToTenant(key, tenantId)) {
      return jsonError('One of those files does not belong to this workspace.', 403)
    }
  }

  let patch: Record<string, unknown>
  try {
    patch = employeeToColumns(input)
  } catch (err) {
    if (err instanceof OnboardingPatchError) return jsonError(err.message, err.status)
    throw err
  }

  const admin = createAdminClient()

  const { data: row, error: loadError } = await admin
    .from('employee_onboarding')
    .select('id, status')
    .eq('employee_profile_id', ctx.userId)
    .eq('tenant_id', tenantId)
    .in('status', ['invited', 'submitted'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (loadError) return jsonError(friendlyDbError(loadError), 400)
  if (!row) return jsonError('You have no onboarding to fill in.', 404)
  if (row.status !== 'invited') {
    return jsonError('Your details have been submitted and are being reviewed.', 409)
  }

  if (Object.keys(patch).length) {
    const { error } = await admin
      .from('employee_onboarding')
      .update(patch)
      .eq('id', row.id)
      .eq('tenant_id', tenantId)
      .eq('employee_profile_id', ctx.userId)
    if (error) return jsonError(friendlyDbError(error), 400)
  }

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
