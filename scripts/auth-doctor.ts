/**
 * AUTH DOCTOR — proves the sign-up / password-reset email path works, end to
 * end, against a DEPLOYED url.
 *
 * Both flows hang off one hop that no browser ever makes and no page can
 * report: Supabase POSTs the token to /api/auth/send-email-hook, and this app
 * sends the mail. If that hop fails for any reason, Supabase ABORTS the auth
 * action — so a wrong webhook secret, a middleware redirect, or an unverified
 * Resend domain all surface to the user as the same unexplained "we could not
 * complete your sign-up", with the real cause visible only in a server log.
 * That blind spot cost a production evening; this script closes it.
 *
 *   npm run auth:doctor                          check localhost:3000
 *   npm run auth:doctor -- https://app.example   check a deployment
 *   npm run auth:doctor -- --send you@work.com   ALSO send one real email
 *
 * WHAT IT CHECKS, and why each one has bitten:
 *   1. the hook is not behind the session redirect  (a 307 → sign-up dies)
 *   2. it is POST-only and says so                  (a followed redirect → GET)
 *   3. an unsigned request is refused               (the endpoint is public)
 *   4. a SIGNED request is accepted                 (deployed secret == local)
 *   5. Resend accepts the configured From address   (domain verified, key live)
 *
 * Check 4 is the one that matters most and the only one that needs a secret. It
 * signs a payload with SUPABASE_SEND_EMAIL_HOOK_SECRET from the local env and
 * uses an action type the handler does not support, so the request gets past
 * signature verification and stops BEFORE any email is sent. A 401 means the
 * deployed secret differs from the local one; a 500 "Unsupported email type" is
 * the pass.
 *
 * NOTHING is printed that would leak a secret. Where a secret must be compared,
 * only a one-way sha256 fingerprint is shown — same fingerprint the server logs
 * on a signature mismatch, so the two can be matched by eye.
 */
import crypto from 'crypto'
import { config } from 'dotenv'

config({ path: '.env.local' })
config()

const args = process.argv.slice(2)
const sendIndex = args.indexOf('--send')
const SEND_TO = sendIndex >= 0 ? args[sendIndex + 1] : ''
const BASE = (args.find((a) => a.startsWith('http')) || 'http://localhost:3000').replace(/\/+$/, '')
const HOOK_URL = `${BASE}/api/auth/send-email-hook`

let failures = 0
const pass = (msg: string) => console.log(`  ✓ ${msg}`)
const fail = (msg: string, fix?: string) => {
  failures++
  console.log(`  ✗ ${msg}`)
  if (fix) console.log(`      → ${fix}`)
}

/** The signing key with both optional prefixes stripped — mirrors the route. */
function signingKey(): string {
  const raw = (process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET || '').trim().replace(/^["']|["']$/g, '')
  const noVersion = raw.startsWith('v1,') ? raw.slice(3) : raw
  return noVersion.startsWith('whsec_') ? noVersion.slice('whsec_'.length) : noVersion
}

function fingerprint(secret: string): string {
  if (!secret) return 'unset'
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8)
}

async function main() {
  console.log(`\nAUTH DOCTOR  →  ${BASE}\n`)

  // --- 1/2. the hook must be reachable, and must not redirect ---------------
  console.log('Hook reachability')
  const unsigned = await fetch(HOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    redirect: 'manual',
  })

  if (unsigned.status >= 300 && unsigned.status < 400) {
    fail(
      `POST is redirected (${unsigned.status} → ${unsigned.headers.get('location')})`,
      'add /api/auth/send-email-hook to MACHINE_PATHS in src/lib/auth/public-paths.ts. ' +
        'Supabase sends no cookie, so a session redirect turns the POST into a GET and ' +
        'every sign-up fails.'
    )
  } else {
    pass('POST reaches the handler (no session redirect)')
  }

  const asGet = await fetch(HOOK_URL, { method: 'GET', redirect: 'manual' })
  if (asGet.status === 405) pass('GET is refused with 405, as it should be')
  else if (asGet.status >= 300 && asGet.status < 400)
    fail(`GET is redirected (${asGet.status})`, 'same fix as above')
  else fail(`GET answered ${asGet.status}, expected 405`)

  // --- 3. unsigned requests must be refused ---------------------------------
  console.log('\nSignature enforcement')
  if (unsigned.status === 401) pass('an unsigned request is refused (401)')
  else if (unsigned.status === 500)
    fail(
      'the hook reports it is not configured',
      'set SUPABASE_SEND_EMAIL_HOOK_SECRET (and RESEND_API_KEY / EMAIL_FROM) on the deployment'
    )
  else fail(`an unsigned request answered ${unsigned.status}, expected 401`)

  // --- 4. a signed request must be accepted ---------------------------------
  const key = signingKey()
  if (!key) {
    fail(
      'SUPABASE_SEND_EMAIL_HOOK_SECRET is not set locally, so the signed check cannot run',
      'copy it from Supabase → Authentication → Hooks → Send Email'
    )
  } else {
    // magiclink is deliberately unsupported: it clears signature verification
    // and stops before Resend, so this check never sends an email.
    const body = JSON.stringify({
      user: { email: 'doctor@example.com' },
      email_data: { token_hash: 'doctor-probe', email_action_type: 'magiclink' },
    })
    const id = 'msg_auth_doctor'
    const ts = Math.floor(Date.now() / 1000)
    const sig = crypto
      .createHmac('sha256', Buffer.from(key, 'base64'))
      .update(`${id}.${ts}.${body}`)
      .digest('base64')

    const signed = await fetch(HOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': id,
        'webhook-timestamp': String(ts),
        'webhook-signature': `v1,${sig}`,
      },
      body,
      redirect: 'manual',
    })

    if (signed.status === 401) {
      fail(
        `the deployment REJECTED a payload signed with the local secret ` +
          `(local fingerprint: ${fingerprint(key)})`,
        'the deployed SUPABASE_SEND_EMAIL_HOOK_SECRET differs from this one. Set the ' +
          'deployment env var to the exact value shown in Supabase → Authentication → ' +
          'Hooks → Send Email, redeploy, and run this again. Until the two match, every ' +
          'sign-up and password reset fails.'
      )
    } else if (signed.status === 500) {
      pass(`signed request accepted — secret matches (fingerprint: ${fingerprint(key)})`)
    } else {
      fail(`signed request answered ${signed.status}; expected 500 (unsupported type)`)
    }
  }

  // --- 5. the sender itself --------------------------------------------------
  console.log('\nSender (Resend)')
  const apiKey = process.env.RESEND_API_KEY || ''
  const from = (process.env.EMAIL_FROM || '').replace(/^["']|["']$/g, '')
  if (!apiKey || !from) {
    fail(
      `not configured locally (RESEND_API_KEY ${apiKey ? 'set' : 'MISSING'}, EMAIL_FROM ${
        from ? 'set' : 'MISSING'
      })`
    )
  } else if (!SEND_TO) {
    console.log(`  • from ${from} — pass --send <address> to attempt a real delivery`)
  } else {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [SEND_TO],
        subject: 'Auth doctor delivery probe',
        html: '<p>If this arrived, the sending domain and API key are good.</p>',
        text: 'If this arrived, the sending domain and API key are good.',
      }),
    })
    const payload = (await res.json().catch(() => null)) as
      | { id?: string; message?: string; name?: string }
      | null
    if (res.ok && payload?.id) pass(`Resend accepted a message from ${from} (id ${payload.id})`)
    else
      fail(
        `Resend refused: ${payload?.name || res.status} — ${payload?.message || 'no detail'}`,
        'verify the EMAIL_FROM domain in the Resend dashboard, and check the API key has send permission'
      )
  }

  console.log(
    failures === 0
      ? '\nALL CHECKS PASSED — sign-up and password-reset email can be delivered.\n'
      : `\n${failures} CHECK(S) FAILED — sign-up and/or password reset are broken.\n`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nauth-doctor could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
