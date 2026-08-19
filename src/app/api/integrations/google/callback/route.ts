import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, createHash, timingSafeEqual } from 'crypto'
import { withErrorHandler } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken } from '@/lib/crypto'
import { appUrl } from '@/lib/env'
import { audit } from '@/lib/audit'
import {
  exchangeCode, emailFromIdToken, watchCalendar, isCalendarConfigured,
} from '@/lib/google-calendar'
import { STATE_COOKIE } from '../connect/route'

export const dynamic = 'force-dynamic'

async function handleGET(request: NextRequest) {
  const origin = new URL(request.url).origin
  const settingsUrl = (params: string) => `${origin}/org/settings/integrations?${params}`
  const failed = (message: string) =>
    NextResponse.redirect(settingsUrl(`error=${encodeURIComponent(message)}`))

  const gate = await apiRequireOrg()
  if (!gate.ok) return NextResponse.redirect(`${origin}/login`)
  const { ctx } = gate

  if (!isCalendarConfigured()) return failed('Google Calendar is not configured.')

  const { searchParams } = new URL(request.url)

  if (searchParams.get('error')) {
    return failed('Google access was not granted.')
  }

  const code = searchParams.get('code')
  const state = searchParams.get('state')
  if (!code || !state) return failed('That authorization response was incomplete.')

  // --- CSRF: the returned state must match the cookie this browser was given --
  const cookieDigest = request.cookies.get(STATE_COOKIE)?.value
  if (!cookieDigest) {
    return failed('Your authorization session expired. Please try connecting again.')
  }

  let parsed: { n?: string; t?: string }
  try {
    parsed = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
  } catch {
    return failed('That authorization response could not be verified.')
  }

  const expected = Buffer.from(cookieDigest)
  const actual = Buffer.from(createHash('sha256').update(parsed.n ?? '').digest('base64url'))
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return failed('That authorization response could not be verified.')
  }

  // The tenant comes from the state we minted, and is then checked against the
  // session — a callback replayed into a different workspace goes nowhere.
  if (parsed.t !== ctx.tenantId) {
    return failed('That authorization belongs to a different workspace.')
  }

  // --- Exchange -----------------------------------------------------------
  let tokens
  try {
    tokens = await exchangeCode(code)
  } catch (err) {
    console.error('[google/callback] exchange failed', err)
    return failed('We could not complete the connection with Google.')
  }

  /*
   * REFUSE a connection with no refresh token.
   *
   * Without one we can only act for the hour the access token lives, after which
   * every sync fails in a way that looks like a bug in this product. Better to
   * reject the connection now with an explanation than to store something that
   * is guaranteed to break. `prompt=consent` on the authorize URL is what should
   * prevent this; reaching here means something unusual happened.
   */
  if (!tokens.refresh_token) {
    return failed(
      'Google did not return a refresh token. Remove Oneclickhr from your ' +
        'Google account permissions (myaccount.google.com/permissions) and connect again.'
    )
  }

  let refreshTokenEnc: string
  try {
    refreshTokenEnc = encryptToken(tokens.refresh_token)
  } catch (err) {
    // Fail-closed encryption: better no connection than a plaintext token.
    console.error('[google/callback] encryption failed', err)
    return failed('The server cannot store Google credentials securely. Please contact support.')
  }

  const admin = createAdminClient()
  const channelId = randomUUID()
  const channelToken = randomUUID()

  const { error } = await admin.from('calendar_connections').upsert(
    {
      tenant_id: ctx.tenantId,
      connected_by: ctx.userId,
      google_email: emailFromIdToken(tokens.id_token),
      google_refresh_token_enc: refreshTokenEnc,
      google_channel_id: channelId,
      status: 'connected',
      // A fresh connection starts with no sync token, so the first pull is a
      // bounded full list.
      sync_token: null,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    },
    { onConflict: 'tenant_id' }
  )

  if (error) {
    console.error('[google/callback] could not save connection', error.message)
    return failed('We could not save that connection. Please try again.')
  }

  // --- Subscribe to push notifications ------------------------------------
  const webhookUrl = `${appUrl()}/api/integrations/google/webhook`
  const watch = await watchCalendar(tokens.access_token, channelId, webhookUrl, channelToken)

  await admin
    .from('calendar_connections')
    .update({
      google_resource_id: watch?.resourceId ?? null,
      channel_expires_at: watch?.expiration ?? null,
      // The token Google will echo back on every push, stored so the webhook can
      // verify the callback really came from our subscription.
      sync_token: null,
    })
    .eq('tenant_id', ctx.tenantId)

  // Keep the channel token where only the server can read it. Reusing the
  // resource-id column would conflate two different things, so it rides in the
  // channel id's namespace instead.
  await admin
    .from('calendar_connections')
    .update({ google_channel_id: `${channelId}:${channelToken}` })
    .eq('tenant_id', ctx.tenantId)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'calendar.connected',
    entity: 'calendar_connections',
    meta: { pushChannel: !!watch },
    request,
  })

  const response = NextResponse.redirect(
    settingsUrl(
      watch
        ? 'connected=1'
        : `connected=1&warning=${encodeURIComponent(
            'Connected, but live updates could not be enabled. Changes will sync every 15 minutes.'
          )}`
    )
  )
  response.cookies.delete(STATE_COOKIE)
  return response
}

export const GET = withErrorHandler(handleGET)
