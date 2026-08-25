import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { completeOnboardingSchema } from '@/lib/schemas'
import { draftFromRow, validateStep, needsVisaDetail, ONBOARDING_STEPS } from '@/lib/onboarding'
import { suggestEmployeeCode } from '@/lib/onboarding-server'
import { generateTempPassword } from '@/lib/crypto'
import { sendEmployeeCredentials, isEmailConfigured } from '@/lib/email'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { appUrl } from '@/lib/env'
import { EMPLOYEE_LOGIN_PATH } from '@/lib/routes'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Turn a completed draft into a real employee account.
 *
 * ORDER IS THE DESIGN, and it is the same rollback discipline the old wizard
 * used (see /api/org/employees), extended over more writes:
 *
 *   1. re-validate all six steps server-side — the client's checks are courtesy
 *   2. create the auth user (the only irreversible-ish step)
 *   3. fill in the profile               → on failure, DELETE the auth user
 *   4. work authorization, if any        → non-fatal, logged
 *   5. mark the draft completed          → non-fatal, logged
 *   6. email the credentials
 *
 * Steps 4–6 deliberately do NOT roll back a working account: an employee who
 * exists and can sign in, with a visa row that needs re-entering, is a far
 * better outcome than deleting the account over a secondary write.
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
  // friendly message, not the guarantee). Blank means "generate one".
  let employeeCode = draft.employeeCode.trim()
  if (employeeCode) {
    const { data: clash } = await admin
      .from('profiles')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('employee_code', employeeCode)
      .maybeSingle()
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

  // --- 3. The auth user ----------------------------------------------------
  const tempPassword = generateTempPassword()
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

  const userId = created.user.id

  /** Undo the auth user, then answer. Keeps every failure path one line. */
  const rollback = async (message: string, status: number) => {
    try {
      await admin.auth.admin.deleteUser(userId)
    } catch (err) {
      console.error('[onboarding] ROLLBACK FAILED — orphaned auth user', userId, err)
    }
    return jsonError(message, status)
  }

  // --- 4. The profile ------------------------------------------------------
  // handle_new_user() has already inserted the row with tenant, role and the
  // forced-password flag; this fills in everything the wizard collected.
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      full_name: fullName,
      email,
      phone: draft.phone || null,
      employee_code: employeeCode,
      designation: draft.designation || null,
      department_id: draft.departmentId,
      date_of_joining: draft.hireDate || null,
      photo_url: draft.photoUrl || null,
      timezone: ctx.tenant.timezone,
      is_active: true,

      preferred_first_name: draft.preferredFirstName || null,
      preferred_last_name: draft.preferredLastName || null,
      pronouns: draft.pronouns || null,
      date_of_birth: draft.dateOfBirth || null,
      gender: draft.gender || null,
      street_address: draft.streetAddress || null,
      apartment: draft.apartment || null,
      city: draft.city || null,
      state_province: draft.stateProvince || null,
      zip_postal: draft.zipPostal || null,
      country: draft.country || null,
      home_phone: draft.homePhone || null,
      work_phone: draft.workPhone || null,
      work_email: draft.workEmail || null,
      hire_date: draft.hireDate || null,
      employment_status: draft.employmentStatus || 'Active',
      reporting_manager_id: draft.reportingManagerId || null,
      pay_type: draft.payType || null,
      pay_rate: draft.payRate === '' ? null : Number(draft.payRate),
      pay_frequency: draft.payFrequency || null,
      employment_type: draft.employmentType || null,
      bank_name: draft.bankName || null,
      account_holder_name: draft.accountHolderName || null,
      // Already ciphertext on the draft — copied across, never re-encrypted and
      // never decrypted on this path.
      account_number_enc: row.account_number_enc ?? null,
      routing_code: draft.routingCode || null,
      account_type: draft.accountType || null,
      emergency_contact_name: draft.emergencyContactName || null,
      emergency_relationship: draft.emergencyRelationship || null,
      emergency_phone: draft.emergencyPhone || null,
      emergency_email: draft.emergencyEmail || null,
      resume_url: draft.resumeUrl || null,
      offer_letter_url: draft.offerLetterUrl || null,
      id_proof_type: draft.idProofType || null,
      id_proof_url: draft.idProofUrl || null,
      additional_docs: draft.additionalDocs,
      internal_notes: draft.internalNotes || null,
      compliance_notes: draft.complianceNotes || null,
    })
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
      current_step: 6,
      completed_steps: [1, 2, 3, 4, 5],
    })
    .eq('id', draftId)
    .eq('tenant_id', tenantId)

  if (draftError) {
    console.error('[onboarding] could not close the draft', draftError.message)
  }

  // --- 8. Deliver the credentials -----------------------------------------
  let emailSent = false
  if (input.sendCredentialsEmail && isEmailConfigured()) {
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
    action: 'employee.onboarded',
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
      tempPassword,
      loginUrl: `${appUrl()}${EMPLOYEE_LOGIN_PATH}`,
    },
    201
  )
}

export const POST = withErrorHandler(handlePOST)
