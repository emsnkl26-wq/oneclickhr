import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { appUrl } from '@/lib/env'
import { safeEqual } from '@/lib/crypto'
import { sendSignupConfirmationEmail, sendPasswordResetEmail } from '@/lib/auth-email'

export const dynamic = 'force-dynamic'

/**
 * Supabase "Send Email" Auth Hook.
 *
 * Once this hook is enabled in the Supabase dashboard (SETUP.md §4), Supabase
 * stops sending confirmation/reset email itself — it POSTs the token here
 * instead, and WE build and send the email via Resend using our own template.
 * That's how the built-in 2/hr sender limit gets bypassed: Resend's API, not
 * Supabase's SMTP relay, does the sending.
 *
 * The link we build is deliberately our own `/auth/confirm?token_hash=...`
 * route rather than `email_data.site_url` — same device-independent
 * `token_hash` flow the rest of the app relies on (see that route's header
 * comment). We only ignore `redirect_to`/`site_url` for THIS purpose; the
 * token itself still comes straight from Supabase.
 *
 * Auth hooks use the Standard Webhooks signing scheme: the dashboard gives a
 * `v1,whsec_<base64>` secret, and each request carries `webhook-id`,
 * `webhook-timestamp` and `webhook-signature` headers computed over
 * `${id}.${timestamp}.${rawBody}`. No SDK dependency needed — it's one HMAC.
 */

interface SendEmailHookPayload {
  user: { email?: string }
  email_data: {
    token_hash: string
    email_action_type: string
  }
}

function hookError(message: string, status: number) {
  return NextResponse.json({ error: { http_code: status, message } }, { status })
}

function verifySignature(rawBody: string, headers: Headers): boolean {
  const secretEnv = process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET || ''
  const secret = secretEnv.startsWith('v1,') ? secretEnv.slice(3) : secretEnv
  const secretKey = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  if (!secretKey) return false

  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')
  if (!id || !timestamp || !signatureHeader) return false

  // Reject anything not within 5 minutes of now — closes the replay window on
  // a captured request.
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false

  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = crypto
    .createHmac('sha256', Buffer.from(secretKey, 'base64'))
    .update(signedContent)
    .digest('base64')

  return signatureHeader
    .split(' ')
    .map((part) => part.split(',')[1])
    .filter(Boolean)
    .some((sig) => safeEqual(sig, expected))
}

async function handlePOST(request: NextRequest) {
  if (!process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET) {
    console.error('[send-email-hook] SUPABASE_SEND_EMAIL_HOOK_SECRET is not configured')
    return hookError('Email hook is not configured', 500)
  }

  const rawBody = await request.text()

  if (!verifySignature(rawBody, request.headers)) {
    return hookError('Invalid signature', 401)
  }

  let payload: SendEmailHookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return hookError('Malformed payload', 400)
  }

  const email = payload.user?.email
  const tokenHash = payload.email_data?.token_hash
  const actionType = payload.email_data?.email_action_type

  if (!email || !tokenHash || !actionType) {
    return hookError('Missing required fields', 400)
  }

  const link = (type: string) => `${appUrl()}/auth/confirm?token_hash=${tokenHash}&type=${type}`

  const result = await (async () => {
    switch (actionType) {
      case 'signup':
        return sendSignupConfirmationEmail({ to: email, confirmUrl: link('signup') })
      case 'recovery':
        return sendPasswordResetEmail({ to: email, resetUrl: link('recovery') })
      default:
        // invite / magiclink / email_change are not used by this app today.
        console.error('[send-email-hook] unsupported email_action_type:', actionType)
        return { ok: false, error: `Unsupported email type: ${actionType}` }
    }
  })()

  if (!result.ok) {
    // Non-2xx here aborts the auth action (e.g. signup) on Supabase's side, so
    // a user is never left "signed up" with no way to receive a confirmation
    // email — they see an error and can retry, rather than silently stalling.
    return hookError(result.error || 'Failed to send email', 500)
  }

  return NextResponse.json({})
}

export const POST = handlePOST
