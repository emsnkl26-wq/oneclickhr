import { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { changePasswordSchema } from '@/lib/schemas'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { apiRequireUser } from '@/lib/auth/guards'
import { rateLimit, limitKey } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'
import { homeFor } from '@/lib/auth/context'

export const dynamic = 'force-dynamic'

/**
 * Change your own password — and, for a teammate signing in for the first time,
 * the gate that lets them into the product at all.
 *
 * The current password is re-verified before the change even though the user is
 * already authenticated. A live session on an unattended laptop should not be
 * enough to take an account over permanently.
 */
async function handlePOST(request: NextRequest) {
  // NOT apiRequireUser's full gate: a user with must_change_password set has to
  // be able to reach exactly this endpoint. apiRequireUser only rejects
  // deactivated/suspended, which is correct here.
  // Also reachable while the workspace is paused for an unverified domain (061):
  // a forced password change and a pause can be in force at once, and a person
  // caught by both would otherwise have no screen they are allowed to finish.
  const gate = await apiRequireUser({ allowDomainLocked: true })
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await rateLimit(limitKey('change-password', ctx.userId), 8, 15 * 60 * 1000)
  if (!limited.ok) {
    return jsonError('Too many attempts. Please wait a few minutes.', 429)
  }

  const input = await parseBody(request, changePasswordSchema)

  const supabase = await createSupabaseServerClient()

  // Re-authenticate. signInWithPassword refreshes the session on success, which
  // is harmless — the user is already this person.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: ctx.email,
    password: input.currentPassword,
  })
  if (reauthError) {
    await audit({
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      actorEmail: ctx.email,
      action: 'auth.change_password_failed',
      request,
    })
    return jsonError('Your current password is not correct.', 401)
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: input.newPassword })
  if (updateError) {
    console.error('[change-password] update failed', updateError.message)
    return jsonError('We could not update your password. Please try again.', 400)
  }

  /*
   * Clear the forced-change flag with the ADMIN client.
   *
   * `must_change_password` is in the profiles guard's privileged set for a
   * reason — a user must not be able to clear it by PATCHing their own row
   * without actually changing anything. Routing it through the server, only
   * after a successful password update, keeps the flag meaningful.
   */
  if (ctx.mustChangePassword) {
    const admin = createAdminClient()
    const { error } = await admin
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', ctx.userId)
    if (error) console.error('[change-password] failed to clear flag', error.message)
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'auth.password_changed',
    entity: 'auth.users',
    entityId: ctx.userId,
    request,
  })

  return jsonOk({ redirectTo: homeFor(ctx.role) })
}

export const POST = withErrorHandler(handlePOST)
