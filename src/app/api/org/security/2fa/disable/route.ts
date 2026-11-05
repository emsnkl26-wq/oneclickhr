import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { twoFactorCodeSchema } from '@/lib/schemas'
import { verifyTotp } from '@/lib/auth/totp'
import { readTwoFactor, clearProofCookie } from '@/lib/auth/two-factor'
import { limitAuthByIp } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Turn two-step verification off.
 *
 * Requires a CURRENT code, not just a live session: turning off a security
 * control is exactly the action that should need the control one last time, so
 * an unlocked laptop cannot quietly disable it.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await limitAuthByIp(request, '2fa')
  if (!limited.ok) return jsonError('Too many attempts. Please wait a few minutes.', 429)

  const { code } = await parseBody(request, twoFactorCodeSchema)
  const supabase = await createSupabaseServerClient()

  const record = await readTwoFactor(supabase, ctx.userId)
  if (!record || !record.enabled) {
    await clearProofCookie()
    return jsonOk({ ok: true, alreadyOff: true })
  }

  if (!verifyTotp(record.secret, code)) {
    return jsonError('That code did not match, so two-step verification was left on.', 400)
  }

  const { error } = await supabase.from('user_two_factor').delete().eq('profile_id', ctx.userId)
  if (error) return jsonError(friendlyDbError(error), 400)

  await clearProofCookie()

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'auth.2fa_disabled',
    entity: 'user_two_factor',
    entityId: ctx.userId,
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
