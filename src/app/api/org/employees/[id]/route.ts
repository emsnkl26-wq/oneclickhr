import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'
import { updateEmployeeSchema } from '@/lib/schemas'
import { keyBelongsToTenant } from '@/lib/r2'
import { audit } from '@/lib/audit'

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
 * Deactivate an employee. NEVER deletes.
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
export const DELETE = withErrorHandler(handleDELETE)
