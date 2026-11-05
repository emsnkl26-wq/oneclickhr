import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { twoFactorCodeSchema } from '@/lib/schemas'
import { verifyTotp } from '@/lib/auth/totp'
import { readTwoFactor, readWindowHours, setProofCookie } from '@/lib/auth/two-factor'
import { limitAuthByIp } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Pass the periodic check: enter a current code to start a fresh window.
 *
 * `allow2faPending` is the whole point — the caller is an enabled admin WITHOUT
 * a valid proof cookie, which is exactly who the ordinary gate turns away. This
 * is the one endpoint that must let them in so they can clear it.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg({ allow2faPending: true })
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const limited = await limitAuthByIp(request, '2fa')
  if (!limited.ok) return jsonError('Too many attempts. Please wait a few minutes.', 429)

  const { code } = await parseBody(request, twoFactorCodeSchema)
  const supabase = await createSupabaseServerClient()

  const record = await readTwoFactor(supabase, ctx.userId)
  if (!record || !record.enabled) {
    // Nothing to verify against — treat as satisfied so they are not stuck.
    return jsonOk({ ok: true, notEnrolled: true })
  }

  if (!verifyTotp(record.secret, code)) {
    return jsonError('That code did not match. Check your authenticator app and try again.', 400)
  }

  await supabase
    .from('user_two_factor')
    .update({ last_verified_at: new Date().toISOString() })
    .eq('profile_id', ctx.userId)

  const windowHours = await readWindowHours(supabase, ctx.tenantId)
  await setProofCookie(ctx.userId, windowHours)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'auth.2fa_verified',
    entity: 'user_two_factor',
    entityId: ctx.userId,
    request,
  })

  return jsonOk({ ok: true })
}

export const POST = withErrorHandler(handlePOST)
