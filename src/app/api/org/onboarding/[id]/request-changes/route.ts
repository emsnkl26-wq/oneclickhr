import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { requestChangesSchema } from '@/lib/schemas'
import { notifyEmployee } from '@/lib/notify'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Send a submitted onboarding back to the employee with a note.
 *
 * The other half of review. Approving is `/complete`; this is the answer for
 * "the address is their old one" — it returns the draft to `invited`, which is
 * simply the state where the employee's form is editable again, and attaches
 * the reason so they are not left guessing which of sixty fields is wrong.
 *
 * NOTHING IS ROLLED BACK. The account stays, the password stays, everything
 * already typed stays. The only change is who the form is waiting on.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const draftId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, requestChangesSchema)

  const admin = createAdminClient()
  const { data: row, error: loadError } = await admin
    .from('employee_onboarding')
    .select('id, status, employee_profile_id, first_name, last_name')
    .eq('id', draftId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (loadError) return jsonError(friendlyDbError(loadError), 400)
  if (!row) return jsonError('That onboarding was not found.', 404)
  if (row.status !== 'submitted') {
    return jsonError('There is nothing waiting for review on this onboarding.', 409)
  }
  if (!row.employee_profile_id) {
    // The 014 constraint makes this unreachable; it is here so a future schema
    // change cannot turn it into a null notification target.
    return jsonError('This onboarding has no employee account to send back to.', 409)
  }

  const { error } = await admin
    .from('employee_onboarding')
    .update({
      status: 'invited',
      review_notes: input.notes,
      reviewed_at: new Date().toISOString(),
      submitted_at: null,
    })
    .eq('id', draftId)
    .eq('tenant_id', tenantId)

  if (error) return jsonError(friendlyDbError(error), 400)

  /*
   * The CALLER'S client, not the admin one — `notifications_write` is what
   * proves an org user raised this, and notifyEmployee never throws, so a
   * failed nudge cannot undo a review that has already happened.
   */
  const supabase = await createSupabaseServerClient()
  await notifyEmployee(supabase, {
    tenantId,
    employeeId: row.employee_profile_id,
    title: 'Your onboarding details need a change',
    description: input.notes,
    createdBy: ctx.userId,
  })

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'onboarding.changes_requested',
    entity: 'employee_onboarding',
    entityId: draftId,
    meta: { employeeId: row.employee_profile_id },
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
