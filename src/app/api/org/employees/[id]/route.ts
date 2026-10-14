import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { updateEmployeeSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'
import { deleteEmployeePermanently } from '@/lib/employee-delete'
import { checkSeatAvailable } from '@/lib/seats'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Edit an employee's details. */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const employeeId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, updateEmployeeSchema)

  if (input.photoKey && !keyBelongsToTenant(input.photoKey, tenantId)) {
    return jsonError('That file does not belong to this workspace.', 403)
  }

  const supabase = await createSupabaseServerClient()

  // Under RLS, an id from another tenant simply matches nothing — the 404 below
  // is the isolation working, not an extra check bolted on.
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, role, email, full_name, is_active')
    .eq('id', employeeId)
    .maybeSingle()

  if (!existing) return jsonError('That employee was not found.', 404)
  if (existing.role !== 'employee') {
    return jsonError('Only employee accounts can be edited here.', 400)
  }

  /*
   * Bringing somebody back takes a seat (061), so it answers to the same limit
   * as adding somebody new — otherwise an org at its cap could deactivate one
   * person, add two, and reactivate the first.
   *
   * Only when the flag is actually CHANGING to active: an ordinary edit that
   * happens to carry `isActive: true` for an already-active employee must not
   * be refused because the workspace is full of the very people it is editing.
   */
  if (input.isActive === true && !existing.is_active) {
    const seats = await checkSeatAvailable(createAdminClient(), tenantId)
    if (!seats.ok) return jsonError(seats.error, 409)
  }

  const patch: Record<string, unknown> = {
    full_name: input.fullName,
    phone: input.phone,
    employee_code: input.employeeCode,
    designation: input.designation,
    department_id: input.departmentId ?? null,
    date_of_joining: input.dateOfJoining ?? null,
    timezone: input.timezone,
  }
  if (input.photoKey !== undefined) patch.photo_url = input.photoKey
  if (typeof input.isActive === 'boolean') patch.is_active = input.isActive
  // (025) Set by the org, never by the employee — `tg_profiles_guard` refuses
  // a self-service change to this column.
  if (input.trackingMode !== undefined) patch.tracking_mode = input.trackingMode
  // (050) Also org-only — the profile guard refuses a self-service change.
  if (input.paySchedule !== undefined) patch.pay_schedule = input.paySchedule
  // (058) Job portal access — toggled by the org, not derived from designation.
  if (typeof input.isRecruiter === 'boolean') patch.is_recruiter = input.isRecruiter
  // (059) Their LinkedIn. `undefined` leaves it alone, null clears it, which is
  // why this is tested for presence rather than truthiness.
  if (input.linkedinUrl !== undefined) patch.linkedin_url = input.linkedinUrl

  const { error } = await supabase.from('profiles').update(patch).eq('id', employeeId)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action:
      typeof input.isActive === 'boolean' && input.isActive !== existing.is_active
        ? input.isActive
          ? 'employee.reactivated'
          : 'employee.deactivated'
        : 'employee.updated',
    entity: 'profiles',
    entityId: employeeId,
    meta: { email: existing.email },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Bring somebody back — the exact inverse of the DELETE below.
 *
 * WHY THIS IS NOT A PATCH. Reactivating used to mean re-sending the whole
 * employee record with `isActive: true`, because PATCH writes every field it
 * validates: a partial body does not leave the others alone, it fails
 * validation, and a body built from a stale page would write stale values back.
 * That made "bring them back" depend on the caller happening to hold a complete,
 * current copy of the person — which is a lot of ways to get a one-bit change
 * wrong. This touches one column and carries no payload at all, so there is
 * nothing to be stale.
 */
async function handlePOST(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const employeeId = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('profiles')
    .select('id, role, email, full_name, is_active')
    .eq('id', employeeId)
    .maybeSingle()

  if (!existing) return jsonError('That employee was not found.', 404)
  if (existing.role !== 'employee') {
    return jsonError('Only employee accounts can be reactivated here.', 400)
  }
  if (existing.is_active) return jsonOk({ ok: true, unchanged: true })

  // Rejoining takes a seat (061), on the same terms as joining for the first
  // time — otherwise an org at its cap could remove one person, add two, and
  // bring the first one back.
  const seats = await checkSeatAvailable(createAdminClient(), tenantId)
  if (!seats.ok) return jsonError(seats.error, 409)

  const { error } = await supabase
    .from('profiles')
    .update({ is_active: true })
    .eq('id', employeeId)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'employee.reactivated',
    entity: 'profiles',
    entityId: employeeId,
    meta: { email: existing.email },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * Remove an employee from the organization. NEVER deletes.
 *
 * Attendance, leave and payroll history reference this profile; removing the row
 * would either cascade real records away or leave dangling ids. Deactivation
 * keeps the history intact and, because `app.is_active_member()` reads
 * `is_active` live on every policy check, revokes access on the very next
 * request rather than whenever their token happens to expire.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate
  const tenantId = assertTenantScope(ctx.tenantId)

  const employeeId = uuidSchema.parse((await params).id)

  if (employeeId === ctx.userId) {
    return jsonError('You cannot deactivate your own account.', 400)
  }

  // `?permanent=true` — the irreversible delete the UI offers behind a typed
  // confirmation. Everything below this block is the default: deactivation.
  if (request.nextUrl.searchParams.get('permanent') === 'true') {
    const result = await deleteEmployeePermanently(employeeId, tenantId)
    if (!result.ok) return jsonError(result.error, result.status)

    await audit({
      tenantId,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'employee.deleted',
      entity: 'profiles',
      entityId: employeeId,
      meta: { email: result.email, name: result.name },
      request,
    })
    return jsonOk({ ok: true, deleted: true })
  }

  const supabase = await createSupabaseServerClient()
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, role, email')
    .eq('id', employeeId)
    .maybeSingle()

  if (!existing) return jsonError('That employee was not found.', 404)
  if (existing.role !== 'employee') {
    return jsonError('Only employee accounts can be deactivated here.', 400)
  }

  const { error } = await supabase
    .from('profiles')
    .update({ is_active: false })
    .eq('id', employeeId)
  if (error) return jsonError(friendlyDbError(error), 400)

  /*
   * Also revoke the refresh tokens. RLS already denies everything on the next
   * request, so this is not what enforces the lockout — it just avoids the
   * confusing middle state where a still-valid access token renders a shell
   * whose every query comes back empty.
   */
  try {
    const admin = createAdminClient()
    await admin.auth.admin.signOut(employeeId, 'global')
  } catch (err) {
    console.warn('[employees] could not revoke sessions (access is already denied)', err)
  }

  await audit({
    tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'employee.deactivated',
    entity: 'profiles',
    entityId: employeeId,
    meta: { email: existing.email },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const POST = withErrorHandler(handlePOST)
export const DELETE = withErrorHandler(handleDELETE)
