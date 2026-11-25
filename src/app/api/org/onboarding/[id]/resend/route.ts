import { NextRequest } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { sendOnboardingReminder, isEmailConfigured } from '@/lib/email'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Nudge an INVITED employee to finish their own onboarding.
 *
 * This is the "resend" next to a card that is waiting on the employee (status
 * `invited`): the account already exists, so there is nothing to create — the
 * only thing missing is that the person has not come back to fill in their
 * share. It re-sends the reminder email with the portal link and nothing else.
 *
 * IT DELIBERATELY DOES NOT TOUCH THE PASSWORD. The employee may already have
 * signed in once and chosen their own; re-issuing a temporary password here
 * would silently invalidate it. Re-issuing credentials is a separate, explicit
 * action on the employee's own page — see `/api/org/employees/[id]/credentials`.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  // A reminder is cheap to send and annoying to receive; cap how often the org
  // can fire them off.
  const limited = await rateLimit(limitKey('onboarding-resend', ctx.userId), 60, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have sent a lot of reminders recently. Please try again later.', 429)
  }

  const draftId = uuidSchema.parse((await params).id)
  const admin = createAdminClient()

  const { data: row, error: loadError } = await admin
    .from('employee_onboarding')
    .select('id, status, employee_profile_id')
    .eq('id', draftId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (loadError) return jsonError(friendlyDbError(loadError), 400)
  if (!row) return jsonError('That onboarding was not found.', 404)
  if (row.status !== 'invited' || !row.employee_profile_id) {
    return jsonError('Only an invited onboarding that is waiting on the employee can be resent.', 409)
  }

  const { data: employee } = await admin
    .from('profiles')
    .select('email, full_name, is_active')
    .eq('id', row.employee_profile_id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!employee?.email) {
    return jsonError('This employee has no email address to send the reminder to.', 400)
  }
  if (employee.is_active === false) {
    return jsonError('Reactivate this employee before sending a reminder.', 400)
  }

  if (!isEmailConfigured()) {
    return jsonError(
      'Email is not configured on the server (RESEND_API_KEY or EMAIL_FROM is missing).',
      400
    )
  }

  const result = await sendOnboardingReminder({
    to: employee.email,
    fullName: employee.full_name ?? '',
    orgName: ctx.tenant.name,
    brandColor: ctx.tenant.primaryColor,
  })

  if (!result.ok) {
    return jsonError(result.error ?? 'The reminder could not be sent. Please try again.', 400)
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'onboarding.reminded',
    entity: 'profiles',
    entityId: row.employee_profile_id,
    meta: { email: employee.email, draftId },
    request,
  })

  return jsonOk({ email: employee.email })
}

export const POST = withErrorHandler(handlePOST)
