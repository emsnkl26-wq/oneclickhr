import { NextRequest, NextResponse } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { completeOnboardingSchema } from '@/lib/schemas'
import { draftFromRow, validateStep, needsVisaDetail, ONBOARDING_STEPS } from '@/lib/onboarding'
import { suggestEmployeeCode, profilePatchFromDraft } from '@/lib/onboarding-server'
import { generateTempPassword } from '@/lib/crypto'
import { sendEmployeeCredentials, isEmailConfigured } from '@/lib/email'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { appUrl } from '@/lib/env'
import { EMPLOYEE_LOGIN_PATH } from '@/lib/routes'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Finish an onboarding: the draft becomes a real, fully-populated employee.
 *
 * TWO WAYS IN, ONE ENDING
 * -----------------------
 * A draft arrives here in one of two states, and the difference is whether an
 * account already exists:
 *
 *   status = 'draft'                → nobody has an account yet. This handler
 *                                     creates it, exactly as it always did.
 *   status = 'invited' | 'submitted' → `/invite` created the account early and
 *                                     the employee has been filling in their
 *                                     own details. This handler APPROVES what
 *                                     is there and writes it onto the profile
 *                                     that already exists.
 *
 * Everything after that point is identical, which is the reason both live here
 * rather than in two endpoints that would drift: the same server-side
 * re-validation of all five steps, the same profile patch, the same visa row,
 * the same document attachment, the same closing of the draft.
 *
 * ORDER IS THE DESIGN, and on the create path it is the same rollback
 * discipline as before:
 *
 *   1. re-validate all five steps server-side — the client's checks are courtesy
 *   2. create the auth user, IF there is not one already
 *   3. fill in the profile               → on failure, DELETE a user we created
 *   4. work authorization, if any        → non-fatal, logged
 *   5. attach uploaded documents         → non-fatal, logged
 *   6. mark the draft completed          → non-fatal, logged
 *   7. email the credentials             → only for an account created here
 *
 * Steps 4–7 deliberately do NOT roll back a working account: an employee who
 * exists and can sign in, with a visa row that needs re-entering, is a far
 * better outcome than deleting the account over a secondary write. On the
 * approval path nothing rolls back at all — the account predates this request
 * and deleting it would destroy a person's sign-in over a failed update.
 *
 * The ADMIN client reads the draft because `account_number_enc` is revoked from
 * `authenticated` at the column level (008) — every query below therefore
 * re-filters `tenant_id` from the SESSION, never from the request.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const limited = await rateLimit(limitKey('create-employee', ctx.userId), 30, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have added a lot of accounts recently. Please try again later.', 429)
  }

  const draftId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, completeOnboardingSchema)

  const admin = createAdminClient()

  const { data: row, error: loadError } = await admin
    .from('employee_onboarding')
    .select('*')
    .eq('id', draftId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (loadError) return jsonError(friendlyDbError(loadError), 400)
  if (!row) return jsonError('That draft was not found.', 404)
  if (row.status === 'completed') {
    return jsonError('This onboarding has already been completed.', 409)
  }
  if (row.status === 'cancelled') {
    return jsonError('This onboarding was cancelled.', 409)
  }

  /** The account this draft already produced, if `/invite` produced one. */
  const existingProfileId: string | null = row.employee_profile_id ?? null

  // --- 1. Validate every step ----------------------------------------------
  const draft = draftFromRow(row)
  const stepErrors: Record<number, Record<string, string>> = {}
  for (const step of ONBOARDING_STEPS) {
    const errors = validateStep(step.index, draft)
    if (Object.keys(errors).length) stepErrors[step.index] = errors
  }
  if (Object.keys(stepErrors).length) {
    return NextResponse.json(
      { error: 'Please complete all required fields', steps: stepErrors },
      { status: 400 }
    )
  }

  const email = draft.personalEmail.trim().toLowerCase()
  const fullName = [draft.firstName, draft.middleName, draft.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()

  // --- 2. Referential checks the schemas cannot make -----------------------
  const { data: department } = await admin
    .from('departments')
    .select('id')
    .eq('id', draft.departmentId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!department) return jsonError('That department was not found.', 400)

  if (draft.reportingManagerId) {
    const { data: manager } = await admin
      .from('profiles')
      .select('id')
      .eq('id', draft.reportingManagerId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!manager) return jsonError('That reporting manager was not found.', 400)
  }

  // Employee code: unique per tenant (enforced by an index — this is the
  // friendly message, not the guarantee). Blank means "generate one", except on
  // the approval path where the invite already issued one worth keeping.
  let employeeCode = draft.employeeCode.trim()
  if (!employeeCode && existingProfileId) {
    const { data: existing } = await admin
      .from('profiles')
      .select('employee_code')
      .eq('id', existingProfileId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    employeeCode = existing?.employee_code ?? ''
  }

  if (employeeCode) {
    let clashQuery = admin
      .from('profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('employee_code', employeeCode)
    // The invited employee already holds this code. Colliding with yourself is
    // not a collision.
    if (existingProfileId) clashQuery = clashQuery.neq('id', existingProfileId)
    const { data: clash } = await clashQuery.maybeSingle()
    if (clash) {
      return NextResponse.json(
        {
          error: 'That employee ID is already in use',
          steps: { 3: { employeeCode: 'Another employee already has this ID' } },
        },
        { status: 409 }
      )
    }
  } else {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('role', 'employee')
    employeeCode = suggestEmployeeCode(count ?? 0)
  }

  // --- 3. The auth user, unless there already is one -----------------------
  let userId: string
  let tempPassword: string | null = null
  /** Only an account created BY THIS REQUEST may be deleted by this request. */
  let createdHere = false

  if (existingProfileId) {
    userId = existingProfileId
  } else {
    tempPassword = generateTempPassword()
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      // TRUSTED metadata — handle_new_user() reads role and tenant from here and
      // nowhere else, which is why a self-signup cannot forge either.
      app_metadata: {
        app_role: 'employee',
        tenant_id: tenantId,
        must_change_password: true,
      },
      user_metadata: { full_name: fullName },
    })

    if (createError || !created.user) {
      const message = (createError?.message || '').toLowerCase()
      if (message.includes('already') || message.includes('registered')) {
        return NextResponse.json(
          {
            error: 'Someone already has an account with that email address',
            steps: { 1: { personalEmail: 'This email is already in use' } },
          },
          { status: 409 }
        )
      }
      console.error('[onboarding] createUser failed', createError)
      return jsonError('We could not create that account. Please try again.', 400)
    }

    userId = created.user.id
    createdHere = true
  }

  /**
   * Undo the auth user, then answer. Keeps every failure path one line.
   *
   * A no-op on the approval path: the account was created by an earlier request
   * and somebody may already be signed into it.
   */
  const rollback = async (message: string, status: number) => {
    if (createdHere) {
      try {
        await admin.auth.admin.deleteUser(userId)
      } catch (err) {
        console.error('[onboarding] ROLLBACK FAILED — orphaned auth user', userId, err)
      }
    }
    return jsonError(message, status)
  }

  // --- 4. The profile ------------------------------------------------------
  // On the create path handle_new_user() has already inserted the row with
  // tenant, role and the forced-password flag; this fills in everything the
  // wizard collected. On the approval path the row is the invited employee's,
  // and this is the moment their submitted answers become their profile.
  const { error: profileError } = await admin
    .from('profiles')
    .update(
      profilePatchFromDraft(draft, row, {
        fullName,
        email,
        employeeCode,
        timezone: ctx.tenant.timezone,
      })
    )
    .eq('id', userId)
    .eq('tenant_id', tenantId)

  if (profileError) {
    if (profileError.code === '23505') {
      return rollback('That employee ID is already in use. Please choose another.', 409)
    }
    return rollback(friendlyDbError(profileError), 400)
  }

  // --- 5. Work authorization (feeds the existing reminder engine) ----------
  // Only an expiry date makes a reminder possible, so that is the trigger.
  if (needsVisaDetail(draft.workAuthStatus) && draft.visaExpiryDate) {
    /*
     * An approval can run after an invite that already recorded one (or after a
     * previous approval attempt), so this is an upsert in spirit: replace the
     * rows for this employee rather than stack a duplicate reminder on every
     * pass. A delete that fails is not fatal — a duplicate reminder is noise,
     * a missing one is a compliance miss.
     */
    if (existingProfileId) {
      const { error: clearError } = await admin
        .from('work_authorizations')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('employee_id', userId)
      if (clearError) {
        console.error('[onboarding] could not clear old work authorizations', clearError.message)
      }
    }

    const { error: visaError } = await admin.from('work_authorizations').insert({
      tenant_id: tenantId,
      employee_id: userId,
      visa_type: draft.visaType || draft.workAuthStatus,
      visa_number: draft.visaNumber || null,
      start_date: draft.visaStartDate || null,
      expiry_date: draft.visaExpiryDate,
      document_url: draft.authDocumentUrl || null,
    })
    if (visaError) {
      console.error('[onboarding] work authorization insert failed', visaError.message)
    }
  }

  // --- 6. Attach the uploaded files to the new employee --------------------
  const documentKeys = [
    draft.authDocumentUrl,
    draft.resumeUrl,
    draft.offerLetterUrl,
    draft.idProofUrl,
    ...draft.additionalDocs.map((d) => d.key),
  ].filter(Boolean)

  if (documentKeys.length) {
    const { error: docError } = await admin
      .from('documents')
      .update({ employee_id: userId })
      .in('file_url', documentKeys)
      .eq('tenant_id', tenantId)
    if (docError) {
      // Not fatal: the files exist and stay visible under Documents, merely
      // unattached. Rolling back a working account over this would be worse.
      console.error('[onboarding] failed to attach documents', docError.message)
    }
  }

  // --- 7. Close the draft --------------------------------------------------
  const { error: draftError } = await admin
    .from('employee_onboarding')
    .update({
      status: 'completed',
      employee_profile_id: userId,
      completed_at: new Date().toISOString(),
      reviewed_at: new Date().toISOString(),
      review_notes: null,
      current_step: 6,
      completed_steps: [1, 2, 3, 4, 5],
    })
    .eq('id', draftId)
    .eq('tenant_id', tenantId)

  if (draftError) {
    console.error('[onboarding] could not close the draft', draftError.message)
  }

  // --- 8. Deliver the credentials -----------------------------------------
  /*
   * Only for an account created HERE. An invited employee chose their own
   * password days ago; there is nothing to send them, and minting a new one to
   * have something to email would sign them out of the session they are
   * probably still in. Their page has an "issue a new password" button for the
   * day it is actually needed.
   */
  let emailSent = false
  if (tempPassword && input.sendCredentialsEmail && isEmailConfigured()) {
    const result = await sendEmployeeCredentials({
      to: email,
      fullName,
      tempPassword,
      orgName: ctx.tenant.name,
      brandColor: ctx.tenant.primaryColor,
    })
    emailSent = result.ok
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: createdHere ? 'employee.onboarded' : 'onboarding.approved',
    entity: 'profiles',
    entityId: userId,
    meta: { email, draftId, emailSent, employeeCode },
    request,
  })

  return jsonOk(
    {
      id: userId,
      email,
      emailSent,
      // Returned once, for the org to read out on the new employee's page.
      // Emailing it as well does not change that: it is stored nowhere and
      // cannot be retrieved again, so this response is the only other copy.
      // Null on the approval path — there was no new password to issue.
      tempPassword,
      loginUrl: `${appUrl()}${EMPLOYEE_LOGIN_PATH}`,
    },
    201
  )
}

export const POST = withErrorHandler(handlePOST)
