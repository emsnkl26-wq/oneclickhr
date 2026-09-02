import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { onboardingDraftSchema } from '@/lib/schemas'
import { toColumns, OnboardingPatchError } from '@/lib/onboarding-server'
import { keyBelongsToTenant } from '@/lib/r2'
import { assertTenantScope } from '@/lib/supabase/admin'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

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
 * Save a draft — "Save for later", the 30-second autosave, and every step change
 * all land here.
 *
 * The patch is sparse by construction (see `toColumns`), so two tabs editing
 * different steps do not clobber each other's columns. Still no account: this
 * endpoint can never create one.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const draftId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, onboardingDraftSchema)

  // Storage keys arrive from the client, so re-prove each one is ours.
  for (const key of keysIn(input as unknown as Record<string, unknown>)) {
    if (!keyBelongsToTenant(key, tenantId)) {
      return jsonError('One of those files does not belong to this workspace.', 403)
    }
  }

  let patch: Record<string, unknown>
  try {
    patch = toColumns(input)
  } catch (err) {
    if (err instanceof OnboardingPatchError) return jsonError(err.message, err.status)
    throw err
  }

  const supabase = await createSupabaseServerClient()

  // RLS scopes this read to the caller's tenant, so a foreign id is simply a 404.
  const { data: existing } = await supabase
    .from('employee_onboarding')
    .select('id, status')
    .eq('id', draftId)
    .maybeSingle()

  if (!existing) return jsonError('That draft was not found.', 404)
  /*
   * `invited` and `submitted` stay editable by the ORG (014). The account
   * exists by then, but the paperwork is still open — an admin correcting a
   * department or a pay rate while the employee fills in their address is the
   * normal case, not a conflict. Only a finished or cancelled onboarding is
   * closed to writes.
   */
  if (existing.status === 'completed' || existing.status === 'cancelled') {
    return jsonError('This onboarding is closed and can no longer be edited.', 409)
  }

  if (Object.keys(patch).length) {
    const { error } = await supabase.from('employee_onboarding').update(patch).eq('id', draftId)
    if (error) return jsonError(friendlyDbError(error), 400)
  }

  return jsonOk({ ok: true })
}

/**
 * Discard a draft.
 *
 * A real delete, not a soft one — unlike an employee, a draft references no
 * attendance, leave or payroll history, so there is nothing to preserve. The
 * RLS delete policy refuses a COMPLETED row, which keeps the record of how an
 * existing account came to exist.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const draftId = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('employee_onboarding')
    .select('id, status, first_name, last_name, personal_email, employee_profile_id')
    .eq('id', draftId)
    .maybeSingle()

  if (!existing) return jsonError('That draft was not found.', 404)
  /*
   * Anything that produced an account is undeletable, not just a completed one:
   * an `invited` row belongs to a real person who can already sign in, and
   * deleting the row would strand them in front of a form that no longer
   * exists. The RLS delete policy in 014 refuses these too — this is the
   * message, that is the guarantee.
   */
  if (existing.status !== 'draft') {
    return jsonError(
      existing.status === 'completed'
        ? 'This onboarding is complete. Deactivate the employee instead.'
        : 'An account already exists for this onboarding. Deactivate the employee instead.',
      409
    )
  }

  const { error } = await supabase.from('employee_onboarding').delete().eq('id', draftId)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'onboarding.draft_deleted',
    entity: 'employee_onboarding',
    entityId: draftId,
    meta: { email: existing.personal_email },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
