import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireEmployee } from '@/lib/auth/guards'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { draftFromRow, EMPLOYEE_STEPS, validateEmployeeStep } from '@/lib/onboarding'
import { EMPLOYEE_EDITABLE_STATUSES, EMPLOYEE_VISIBLE_STATUSES } from '@/lib/employee-onboarding'
import type { OnboardingStatus } from '@/types/db'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Hand the completed details back to the organization for review.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not touch `profiles`. An employee's answers become their profile only
 * when an org admin approves them through `/api/org/onboarding/[id]/complete` —
 * so submitting is a change of who the form is waiting on, and nothing more.
 * That is what makes the review real rather than decorative, and it is why this
 * flow needs no widening of `tg_profiles_guard`.
 *
 * The validation is the employee's steps only, run from the same schemas the
 * org's wizard uses. Fields they were never shown — pay, department, hire date
 * — are not their responsibility and cannot block them; the org's own
 * `/complete` insists on those before anyone becomes a finished employee.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireEmployee()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  // A submission notifies people. Ten an hour is far past "I hit the button
  // twice" and well short of anything a real person would run into.
  const limited = await rateLimit(limitKey('onboarding-submit', ctx.userId), 10, 60 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('You have submitted this a few times already. Please try again later.', 429)
  }

  const admin = createAdminClient()

  const { data: row, error: loadError } = await admin
    .from('employee_onboarding')
    .select('*')
    .eq('employee_profile_id', ctx.userId)
    .eq('tenant_id', tenantId)
    .in('status', EMPLOYEE_VISIBLE_STATUSES as string[])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (loadError) return jsonError(friendlyDbError(loadError), 400)
  if (!row) return jsonError('You have no onboarding to submit.', 404)
  if (!EMPLOYEE_EDITABLE_STATUSES.includes(row.status as OnboardingStatus)) {
    return jsonError('You have already submitted these details.', 409)
  }

  /*
   * Re-submitting an ALREADY COMPLETED onboarding is a change request, not a
   * first submission (M2 #1).
   *
   * The distinction matters in exactly one place — the employee portal gate in
   * src/app/employee/layout.tsx confines somebody whose onboarding has NEVER
   * been completed, and reads `completed_at` rather than the status to decide.
   * So `completed_at` is left alone here: a person correcting their address
   * keeps working while an admin looks at it, which a new starter does not.
   */
  const isCorrection = row.status === 'completed'

  const draft = draftFromRow(row)
  const stepErrors: Record<number, Record<string, string>> = {}
  for (const step of EMPLOYEE_STEPS) {
    const errors = validateEmployeeStep(step.index, draft)
    if (Object.keys(errors).length) stepErrors[step.index] = errors
  }
  if (Object.keys(stepErrors).length) {
    return NextResponse.json(
      { error: 'Please complete all required fields', steps: stepErrors },
      { status: 400 }
    )
  }

  const { error } = await admin
    .from('employee_onboarding')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      employee_step: EMPLOYEE_STEPS.length + 1,
      employee_completed_steps: EMPLOYEE_STEPS.map((s) => s.index),
      // The note that sent it back has been acted on; leaving it would show a
      // stale complaint next to a fresh submission.
      review_notes: null,
    })
    .eq('id', row.id)
    .eq('tenant_id', tenantId)
    .eq('employee_profile_id', ctx.userId)

  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: isCorrection ? 'onboarding.correction_submitted' : 'onboarding.submitted',
    entity: 'employee_onboarding',
    entityId: row.id,
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
