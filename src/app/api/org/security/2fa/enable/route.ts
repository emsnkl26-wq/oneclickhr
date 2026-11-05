import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { twoFactorCodeSchema } from '@/lib/schemas'
import { verifyTotp } from '@/lib/auth/totp'
import { readTwoFactor, readWindowHours, setProofCookie } from '@/lib/auth/two-factor'
import { limitAuthByIp } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Finish enrolling: prove the pending secret with a code, then switch 2FA on.
 *
 * A valid code here also writes the proof cookie, so the person who just turned
 * it on is not immediately bounced to the verify screen.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  // Throttle code attempts per IP — a 6-digit code must not be brute-forceable.
  const limited = await limitAuthByIp(request, '2fa')
  if (!limited.ok) return jsonError('Too many attempts. Please wait a few minutes.', 429)

  const { code } = await parseBody(request, twoFactorCodeSchema)
  const supabase = await createSupabaseServerClient()

  const record = await readTwoFactor(supabase, ctx.userId)
  if (!record) {
    return jsonError('Start the setup again — we could not find a pending secret.', 400)
  }
  if (record.enabled) return jsonOk({ ok: true, alreadyEnabled: true })

  if (!verifyTotp(record.secret, code)) {
    return jsonError('That code did not match. Check your authenticator app and try again.', 400)
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('user_two_factor')
    .update({ enabled: true, enrolled_at: now, last_verified_at: now })
    .eq('profile_id', ctx.userId)
  if (error) return jsonError(friendlyDbError(error), 400)

  const windowHours = await readWindowHours(supabase, ctx.tenantId)
  await setProofCookie(ctx.userId, windowHours)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'auth.2fa_enabled',
    entity: 'user_two_factor',
    entityId: ctx.userId,
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
