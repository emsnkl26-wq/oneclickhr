import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { appUrl } from '@/lib/env'
import { safeEqual } from '@/lib/crypto'
import { sendSignupConfirmationEmail, sendPasswordResetEmail } from '@/lib/auth-email'

export const dynamic = 'force-dynamic'

/**
 * Supabase "Send Email" Auth Hook — OPTIONAL, and OFF in this deployment.
 *
 * Auth email is normally sent by Supabase itself over custom SMTP (Resend), with
 * the templates in supabase/templates/ pasted into the dashboard. That path has
 * no moving parts of ours in it at all, which is why it is the default: nothing
 * here can break a sign-up.
 *
 * This route exists for the one reason to prefer the hook — Supabase's SMTP
 * send-rate limit. Enabling the hook in the dashboard makes Supabase stop
 * sending the mail and POST the token here instead, and the app sends it through
 * the Resend API, whose limits are Resend's rather than Supabase's. Turn it on
 * only if that limit becomes the constraint, and run `npm run auth:doctor --
 * <url> --hook` immediately after: a hook that answers non-2xx ABORTS every
 * sign-up, so a misconfigured secret here is worse than no hook at all.
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
 *
 * THIS ROUTE MUST BE PUBLIC IN MIDDLEWARE. Supabase calls it with no session
 * cookie; a middleware redirect turns the POST into a 307 the sender follows as
 * a GET, and the resulting non-2xx aborts every sign-up. See PUBLIC_PATHS in
 * src/middleware.ts.
 *
 * LOGGING CONTRACT: a failure here breaks sign-up and password reset, so every
 * exit path logs WHICH stage failed and why. None of it is sensitive — no token
 * hash, no full address, no secret. `secretFingerprint()` exists so the
 * configured secret can be compared against the Supabase dashboard's value from
 * a log line without the value ever being printed.
 */

interface SendEmailHookPayload {
  user: { email?: string }
  email_data: {
    token_hash: string
    email_action_type: string
  }
}

/** `alice@corp.com` -> `a***@corp.com`. Enough to correlate, not enough to harvest. */
function redactEmail(email: string): string {
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  return `${email[0]}***${email.slice(at)}`
}

/**
 * First 8 hex of SHA-256 of the configured secret. A one-way fingerprint: it
 * cannot be reversed, but two deployments printing the same value are
 * definitively configured with the same secret — which is how a
 * Vercel-vs-Supabase mismatch gets diagnosed without anyone pasting a secret
 * into a log or a chat window.
 */
function secretFingerprint(secret: string): string {
  if (!secret) return 'unset'
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8)
}

function hookError(message: string, status: number) {
  return NextResponse.json({ error: { http_code: status, message } }, { status })
}

/** The signing key, with both optional prefixes (`v1,`, `whsec_`) stripped. */
function signingKey(): string {
  // Quotes survive a copy-paste into a hosting dashboard's env-var field more
  // often than anyone expects, and a quoted secret hashes to the wrong key.
  const raw = (process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET || '').trim().replace(/^["']|["']$/g, '')
  const noVersion = raw.startsWith('v1,') ? raw.slice(3) : raw
  return noVersion.startsWith('whsec_') ? noVersion.slice('whsec_'.length) : noVersion
}

type SignatureResult = { ok: true } | { ok: false; reason: string }

/**
 * Returns WHY verification failed, not just that it did. The four causes need
 * four different fixes — a missing header means the caller isn't Supabase, skew
 * means clocks, a mismatch means the secret differs from the dashboard's — and
 * collapsing them into one boolean is what made the last production failure
 * take an evening to find.
 */
function verifySignature(rawBody: string, headers: Headers): SignatureResult {
  const secretKey = signingKey()
  if (!secretKey) return { ok: false, reason: 'secret-not-configured' }

  const id = headers.get('webhook-id')
  const timestamp = headers.get('webhook-timestamp')
  const signatureHeader = headers.get('webhook-signature')
  if (!id || !timestamp || !signatureHeader) {
    const missing = [
      !id && 'webhook-id',
      !timestamp && 'webhook-timestamp',
      !signatureHeader && 'webhook-signature',
    ].filter(Boolean)
    return { ok: false, reason: `missing-headers: ${missing.join(', ')}` }
  }

  // Reject anything not within 5 minutes of now — closes the replay window on
  // a captured request.
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'timestamp-not-numeric' }
  const skew = Math.round(Date.now() / 1000 - ts)
  if (Math.abs(skew) > 5 * 60) return { ok: false, reason: `timestamp-skew: ${skew}s` }

  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = crypto
    .createHmac('sha256', Buffer.from(secretKey, 'base64'))
    .update(signedContent)
    .digest('base64')

  const provided = signatureHeader
    .split(' ')
    .map((part) => part.split(',')[1])
    .filter(Boolean)

  if (provided.length === 0) return { ok: false, reason: 'signature-header-unparseable' }
  if (!provided.some((sig) => safeEqual(sig, expected))) {
    // The secret is WRONG, not absent. Print the fingerprint of what we hold so
    // it can be compared against the dashboard.
    return {
      ok: false,
      reason: `signature-mismatch (configured secret fingerprint: ${secretFingerprint(
        secretKey
      )})`,
    }
  }

  return { ok: true }
}

async function handlePOST(request: NextRequest) {
  if (!process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET) {
    console.error(
      '[send-email-hook] SUPABASE_SEND_EMAIL_HOOK_SECRET is not configured — every ' +
        'sign-up and password reset will fail until it is set to the same value as the ' +
        'Supabase dashboard Send Email hook secret'
    )
    return hookError('Email hook is not configured', 500)
  }

  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    console.error('[send-email-hook] sender not configured', {
      RESEND_API_KEY: process.env.RESEND_API_KEY ? 'set' : 'MISSING',
      EMAIL_FROM: process.env.EMAIL_FROM ? 'set' : 'MISSING',
    })
    return hookError('Email sender is not configured', 500)
  }

  const rawBody = await request.text()

  const signature = verifySignature(rawBody, request.headers)
  if (!signature.ok) {
    console.error('[send-email-hook] signature rejected —', signature.reason)
    return hookError('Invalid signature', 401)
  }

  let payload: SendEmailHookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.error('[send-email-hook] body is not JSON', { bytes: rawBody.length })
    return hookError('Malformed payload', 400)
  }

  const email = payload.user?.email
  const tokenHash = payload.email_data?.token_hash
  const actionType = payload.email_data?.email_action_type

  if (!email || !tokenHash || !actionType) {
    console.error('[send-email-hook] payload missing fields', {
      user_email: !!email,
      token_hash: !!tokenHash,
      email_action_type: actionType || 'MISSING',
    })
    return hookError('Missing required fields', 400)
  }

  const to = redactEmail(email)
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
    console.error('[send-email-hook] send failed', {
      action: actionType,
      to,
      // Resend's own words, e.g. "The gmail.com domain is not verified" or
      // "You can only send testing emails to your own email address".
      reason: result.error,
    })
    return hookError(result.error || 'Failed to send email', 500)
  }

  console.log('[send-email-hook] sent', { action: actionType, to })
  return NextResponse.json({})
}

export const POST = handlePOST

/**
 * Supabase only ever POSTs here. A GET means something rewrote the request —
 * historically a middleware redirect that the sender followed as a GET, which
 * silently broke every sign-up. Say so loudly rather than answering Next's
 * default 405 with no explanation.
 */
export async function GET() {
  console.error(
    '[send-email-hook] received a GET — this endpoint is POST-only. A GET here usually ' +
      'means the POST was redirected (check that the path is listed in PUBLIC_PATHS in ' +
      'src/middleware.ts and that the hook URL in Supabase has no trailing slash or ' +
      'apex/www redirect).'
  )
  return hookError('This endpoint accepts POST only', 405)
}
