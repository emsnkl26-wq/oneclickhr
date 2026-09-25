import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteUserSchema, userActivationSchema } from '@/lib/schemas'
import { verifyOwnPassword } from '@/lib/auth/reauth'
import { deletePersonPermanently } from '@/lib/platform-delete'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Platform-level activation control for any user in any tenant.
 *
 * Scope is deliberately narrow: activate/deactivate, nothing else. A super admin
 * is the platform operator, not an administrator of a customer's people — they
 * do not edit names, roles, salaries or documents, and the RLS bypass they hold
 * is read-only precisely so that stays true.
 */
async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const userId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, userActivationSchema)

  if (userId === ctx.userId) {
    return jsonError('You cannot deactivate your own account.', 400)
  }

  const admin = createAdminClient()

  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, role, tenant_id, is_active')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) return jsonError('That user was not found.', 404)
  if (profile.role === 'super_admin') {
    // Platform accounts are managed in Supabase, not through this console — one
    // compromised session should not be able to lock out the other operators.
    return jsonError('Platform administrator accounts cannot be changed here.', 403)
  }

  const { error } = await admin
    .from('profiles')
    .update({ is_active: input.isActive })
    .eq('id', userId)

  if (error) return jsonError(friendlyDbError(error), 400)

  // Access is already denied by RLS on the next request; this just clears the
  // confusing middle state of a live token rendering an empty shell.
  if (!input.isActive) {
    try {
      await admin.auth.admin.signOut(userId, 'global')
    } catch (err) {
      console.warn('[super/users] session revoke failed (access already denied)', err)
    }
  }

  await audit({
    tenantId: profile.tenant_id,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: input.isActive ? 'user.reactivated_by_platform' : 'user.deactivated_by_platform',
    entity: 'profiles',
    entityId: userId,
    meta: { email: profile.email, role: profile.role, reason: input.reason },
    request,
  })

  return jsonOk({ ok: true })
}

/**
 * PERMANENTLY delete one employee or job seeker, from any organization (053).
 *
 * The operator types the person's email and re-enters their own password.
 * Organization admins are refused (see deletePersonPermanently) — they go with
 * their organization.
 */
async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const userId = uuidSchema.parse((await params).id)
  const input = await parseBody(request, deleteUserSchema)

  if (userId === ctx.userId) return jsonError('You cannot delete your own account.', 400)

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, role, tenant_id')
    .eq('id', userId)
    .maybeSingle()

  if (!profile) return jsonError('That account was not found.', 404)
  if (String(profile.email ?? '').toLowerCase() !== input.confirmEmail.toLowerCase()) {
    return jsonError('The email you typed does not match this account.', 400)
  }

  const reauth = await verifyOwnPassword(ctx.userId, ctx.email, input.password)
  if (!reauth.ok) return jsonError(reauth.error, reauth.status)

  const result = await deletePersonPermanently(userId)
  if (!result.ok) return jsonError(result.error, result.status)

  await audit({
    tenantId: profile.tenant_id ?? null,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'user.deleted_by_platform',
    entity: 'profiles',
    entityId: userId,
    meta: { email: result.email, role: result.role, reason: input.reason, filesRemoved: result.filesRemoved },
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
