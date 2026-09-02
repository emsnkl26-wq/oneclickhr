import { NextRequest, NextResponse } from 'next/server'
import {
  withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema,
} from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { inviteOnboardingSchema, inviteReadySchema } from '@/lib/schemas'
import { draftFromRow } from '@/lib/onboarding'
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
 * Create the account NOW, and let the employee fill in the rest.
 *
 * THE POINT OF THIS ENDPOINT
 * --------------------------
 * `/complete` demands all five steps before an account exists, which makes the
 * org the data-entry clerk for information only the employee has. This one
 * demands three fields — first name, last name, sign-in email — issues the
 * credentials, and parks the draft at `invited`. From there either side can
 * finish it: the org by carrying on through the wizard, or the employee by
 * signing in and completing their own share.
 *
 * IT IS `/complete` MINUS THE VALIDATION, NOT A SECOND WAY TO MAKE AN EMPLOYEE.
 * The same order of writes, the same rollback of the auth user if a later step
 * fails, the same one-time password that is returned once and stored nowhere.
 * The profile it writes is simply mostly empty, and `status = 'invited'` is what
 * says so — which is why nothing here marks the draft completed or stamps
 * `completed_at`.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  // Shares a budget with `/complete`: both mint an account, and the limit caps
  // accounts created, not endpoints called.
  const limited = await rateLimit(limitKey('create-employee', ctx.userId), 30, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have added a lot of accounts recently. Please try again later.', 429)
  }

  const draftId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, inviteOnboardingSchema)

  const admin = createAdminClient()

  const { data: row, error: loadError } = await admin
    .from('employee_onboarding')
    .select('*')
    .eq('id', draftId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (loadError) return jsonError(friendlyDbError(loadError), 400)
  if (!row) return jsonError('That draft was not found.', 404)
  if (row.employee_profile_id) {
    return jsonError('An account has already been created for this onboarding.', 409)
  }
  if (row.status !== 'draft') {
    return jsonError('This onboarding can no longer be invited.', 409)
  }

  // --- 1. The three fields an account cannot exist without ------------------
  const draft = draftFromRow(row)
  const ready = inviteReadySchema.safeParse({
    firstName: draft.firstName || undefined,
    lastName: draft.lastName || undefined,
    personalEmail: draft.personalEmail || undefined,
  })
  if (!ready.success) {
    const errors: Record<string, string> = {}
    for (const issue of ready.error.issues) {
      const key = String(issue.path[0] ?? '_')
      if (!errors[key]) errors[key] = issue.message
    }
    return NextResponse.json(
      {
        error: 'Add their name and email address before creating the account',
        steps: { 1: errors },
      },
      { status: 400 }
    )
  }

  const email = draft.personalEmail.trim().toLowerCase()
  const fullName = [draft.firstName, draft.middleName, draft.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()

  // --- 2. Referential checks, only for what has been filled in so far -------
  if (draft.departmentId) {
    const { data: department } = await admin
      .from('departments')
      .select('id')
      .eq('id', draft.departmentId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!department) return jsonError('That department was not found.', 400)
  }

  if (draft.reportingManagerId) {
    const { data: manager } = await admin
      .from('profiles')
      .select('id')
      .eq('id', draft.reportingManagerId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!manager) return jsonError('That reporting manager was not found.', 400)
  }

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
    console.error('[onboarding/invite] createUser failed', createError)
    return jsonError('We could not create that account. Please try again.', 400)
  }

  const userId = created.user.id

  /** Undo the auth user, then answer. Keeps every failure path one line. */
  const rollback = async (message: string, status: number) => {
    try {
      await admin.auth.admin.deleteUser(userId)
    } catch (err) {
      console.error('[onboarding/invite] ROLLBACK FAILED — orphaned auth user', userId, err)
    }
    return jsonError(message, status)
  }

  // --- 4. The profile, as far as it goes -----------------------------------
  // handle_new_user() has already inserted the row with tenant, role and the
  // forced-password flag; this fills in whatever the wizard has so far, which
  // on an early invite may be little more than a name.
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

  // --- 5. Hand the draft over ----------------------------------------------
  /*
   * Unlike the secondary writes in `/complete`, this one IS fatal. A draft that
   * still says `draft` next to an account that exists is a state nothing else
   * in the app understands: the org would be offered "create account" again,
   * and the employee would sign in to no form at all. Rolling the account back
   * returns to a clean draft the org can simply invite again.
   */
  const { error: draftError } = await admin
    .from('employee_onboarding')
    .update({
      status: 'invited',
      employee_profile_id: userId,
      invited_at: new Date().toISOString(),
      review_notes: null,
    })
    .eq('id', draftId)
    .eq('tenant_id', tenantId)

  if (draftError) {
    console.error('[onboarding/invite] could not mark the draft invited', draftError.message)
    return rollback('We could not start this invitation. Please try again.', 400)
  }

  // --- 6. Attach anything already uploaded ---------------------------------
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
      console.error('[onboarding/invite] failed to attach documents', docError.message)
    }
  }

  // --- 7. Deliver the credentials -----------------------------------------
  let emailSent = false
  if (input.sendCredentialsEmail && isEmailConfigured()) {
    const result = await sendEmployeeCredentials({
      to: email,
      fullName,
      tempPassword,
      orgName: ctx.tenant.name,
      brandColor: ctx.tenant.primaryColor,
      // Changes the copy: this person is being asked to finish a form, not
      // merely told an account exists.
      completeOnboarding: true,
    })
    emailSent = result.ok
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'onboarding.invited',
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
      // Returned once. Stored nowhere and unrecoverable afterwards — the org
      // copies it from the dialog, or issues a fresh one from the employee's
      // page later.
      tempPassword,
      loginUrl: `${appUrl()}${EMPLOYEE_LOGIN_PATH}`,
    },
    201
  )
}

export const POST = withErrorHandler(handlePOST)
