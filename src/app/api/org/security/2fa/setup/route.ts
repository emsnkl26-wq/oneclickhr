import { NextRequest } from 'next/server'
import QRCode from 'qrcode'
import { withErrorHandler, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { generateTotpSecret, otpauthUrl } from '@/lib/auth/totp'
import { encryptSecret } from '@/lib/auth/two-factor'
import { isEncryptionConfigured } from '@/lib/crypto'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Begin enrolling an authenticator (064).
 *
 * Mints a fresh secret, stores it PENDING (enabled = false) — so a half-finished
 * setup never gates anybody — and hands back the QR and the secret string for
 * the one admin doing the enrolling. The secret only becomes a real second
 * factor once `/enable` proves they can read a code from it.
 *
 * Not gated by 2FA itself: the caller has not enabled it yet, so the gate lets
 * them through regardless.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  // The secret is stored encrypted; without a key there is nothing safe to do.
  if (!isEncryptionConfigured()) {
    return jsonError(
      'Two-step verification is not available on this server yet. Please contact support.',
      503
    )
  }

  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('user_two_factor')
    .select('enabled')
    .eq('profile_id', ctx.userId)
    .maybeSingle()
  if (existing?.enabled) {
    return jsonError(
      'Two-step verification is already on. Turn it off first to set up a new device.',
      409
    )
  }

  const secret = generateTotpSecret()
  const issuer = ctx.tenant.name?.trim() || 'NextKin'
  const account = ctx.email || 'admin'
  const url = otpauthUrl(secret, account, issuer)

  const { error } = await supabase.from('user_two_factor').upsert(
    {
      profile_id: ctx.userId,
      tenant_id: ctx.tenantId,
      secret_enc: encryptSecret(secret),
      enabled: false,
      enrolled_at: null,
      last_verified_at: null,
    },
    { onConflict: 'profile_id' }
  )
  if (error) return jsonError(friendlyDbError(error), 400)

  const qr = await QRCode.toDataURL(url, { margin: 1, width: 240 })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'auth.2fa_setup_started',
    entity: 'user_two_factor',
    entityId: ctx.userId,
    request,
  })

  // `secret` is this admin's own, over HTTPS — needed for "can't scan? enter it".
  return jsonOk({ secret, otpauthUrl: url, qr })
}

export const POST = withErrorHandler(handlePOST)
