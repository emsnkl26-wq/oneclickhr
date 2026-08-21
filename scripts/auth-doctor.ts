/**
 * AUTH DOCTOR — proves the sign-up / password-reset email path works, end to
 * end, against a DEPLOYED url.
 *
 *   npm run auth:doctor                                   check localhost:3000
 *   npm run auth:doctor -- https://app.example            check a deployment
 *   npm run auth:doctor -- https://app.example --send me@work.com
 *   npm run auth:doctor -- https://app.example --signup me@work.com
 *   npm run auth:doctor -- https://app.example --hook     also check the (optional) Auth Hook
 *
 * HOW AUTH EMAIL IS SENT HERE
 *
 * Supabase sends it, through custom SMTP (Resend) — see SETUP.md §4. The app is
 * not in that path at all, which means the two things that can break it are both
 * dashboard settings rather than code:
 *
 *   • the EMAIL TEMPLATE must link to /auth/confirm?token_hash=…, not to the
 *     default `{{ .ConfirmationURL }}`. The stock link is a PKCE `?code=` url
 *     that only works in the browser that started the signup, so opening the
 *     email on a phone fails. `npm run email:templates` generates the correct
 *     ones.
 *   • SMTP itself must be enabled and its sender domain verified.
 *
 * Neither shows up in a browser console, and a wrong template fails only for
 * the user who opens their mail on a second device — which is why this script
 * checks the pieces directly instead of trusting a green sign-up form.
 *
 * The Auth Hook (--hook) is OPTIONAL and off by default: it is only worth
 * enabling to bypass Supabase's SMTP send-rate limit. When it is disabled in the
 * dashboard, its checks here are noise.
 *
 * NOTHING printed leaks a secret. Where a secret must be compared, only a
 * one-way sha256 fingerprint is shown — the same one the server logs.
 */
import crypto from 'crypto'
import { config } from 'dotenv'

config({ path: '.env.local' })
config()

const args = process.argv.slice(2)
const flagValue = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : ''
}
const SEND_TO = flagValue('--send')
const SIGNUP_AS = flagValue('--signup')
const CHECK_HOOK = args.includes('--hook')
const BASE = (args.find((a) => a.startsWith('http')) || 'http://localhost:3000').replace(/\/+$/, '')

let failures = 0
const pass = (msg: string) => console.log(`  ✓ ${msg}`)
const info = (msg: string) => console.log(`  • ${msg}`)
const fail = (msg: string, fix?: string) => {
  failures++
  console.log(`  ✗ ${msg}`)
  if (fix) console.log(`      → ${fix}`)
}

function fingerprint(secret: string): string {
  if (!secret) return 'unset'
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8)
}

/** The hook signing key with both optional prefixes stripped — mirrors the route. */
function signingKey(): string {
  const raw = (process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET || '').trim().replace(/^["']|["']$/g, '')
  const noVersion = raw.startsWith('v1,') ? raw.slice(3) : raw
  return noVersion.startsWith('whsec_') ? noVersion.slice('whsec_'.length) : noVersion
}

/**
 * Supabase's own view of the project's auth config. Public endpoint, read with
 * the anon key — it is what the client library itself calls on boot.
 */
async function checkSupabaseSettings() {
  console.log('\nSupabase auth configuration')
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !anon) {
    fail('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set locally')
    return
  }

  const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anon } })
  if (!res.ok) {
    fail(`could not read auth settings (${res.status})`)
    return
  }
  const s = (await res.json()) as {
    disable_signup?: boolean
    mailer_autoconfirm?: boolean
    external?: Record<string, boolean>
  }

  if (s.disable_signup) {
    fail('new sign-ups are DISABLED for this project', 'Authentication → Sign In / Providers → Allow new users to sign up')
  } else {
    pass('new sign-ups are allowed')
  }

  if (s.external?.email === false) {
    fail('the email provider is disabled', 'Authentication → Sign In / Providers → Email')
  } else {
    pass('email provider is enabled')
  }

  // autoconfirm ON means Supabase never sends a confirmation email at all —
  // accounts are live immediately. That is a legitimate choice, but it is not
  // this product's flow (the app tells the user to check their inbox), so it is
  // worth stating plainly rather than leaving someone to wonder where the mail
  // went.
  if (s.mailer_autoconfirm) {
    fail(
      'email auto-confirm is ON — Supabase will NOT send a confirmation email',
      'Authentication → Sign In / Providers → Confirm email. The app tells users to check their inbox, so this must be on.'
    )
  } else {
    pass('email confirmation is required (a confirmation email is sent on sign-up)')
  }
}

/**
 * The link target every auth email points at. If this route is missing or
 * redirects oddly, every confirmation link in every already-delivered email is
 * dead — so it is checked against the deployment, not just assumed.
 */
async function checkConfirmRoute() {
  console.log('\nConfirmation link target')
  const res = await fetch(`${BASE}/auth/confirm`, { redirect: 'manual' })
  const location = res.headers.get('location') || ''
  if (res.status >= 300 && res.status < 400 && location.includes('/login')) {
    pass('/auth/confirm is live and rejects an incomplete link cleanly')
  } else {
    fail(
      `/auth/confirm answered ${res.status} (location: ${location || 'none'})`,
      'this route verifies the token_hash server-side; every email link depends on it'
    )
  }

  const withToken = await fetch(`${BASE}/auth/confirm?token_hash=doctor-probe&type=signup`, {
    redirect: 'manual',
  })
  const tokenLocation = withToken.headers.get('location') || ''
  if (tokenLocation.includes('error=')) {
    pass('an invalid token is refused with a readable message (not a 500)')
  } else {
    fail(`an invalid token produced ${withToken.status} → ${tokenLocation || 'no redirect'}`)
  }
}

/** The optional Send Email Auth Hook. Skipped unless --hook is passed. */
async function checkHook() {
  console.log('\nSend Email Auth Hook (optional — only if enabled in Supabase)')
  const HOOK_URL = `${BASE}/api/auth/send-email-hook`

  const unsigned = await fetch(HOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    redirect: 'manual',
  })

  if (unsigned.status >= 300 && unsigned.status < 400) {
    fail(
      `POST is redirected (${unsigned.status} → ${unsigned.headers.get('location')})`,
      'add the path to MACHINE_PATHS in src/lib/auth/public-paths.ts'
    )
  } else if (unsigned.status === 401) {
    pass('unsigned requests are refused, and the POST is not redirected')
  } else {
    fail(`an unsigned request answered ${unsigned.status}, expected 401`)
  }

  const key = signingKey()
  if (!key) {
    info('SUPABASE_SEND_EMAIL_HOOK_SECRET is not set locally — signed check skipped')
    return
  }

  // magiclink is deliberately unsupported: it clears signature verification and
  // stops before any email is sent.
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

  if (signed.status === 500) {
    pass(`signed request accepted — deployed secret matches (fingerprint: ${fingerprint(key)})`)
  } else if (signed.status === 401) {
    fail(
      `the deployment rejected a payload signed with the local secret (local fingerprint: ${fingerprint(
        key
      )})`,
      'the deployed SUPABASE_SEND_EMAIL_HOOK_SECRET differs from this one — or the hook is not in use, in which case drop --hook'
    )
  } else {
    fail(`signed request answered ${signed.status}; expected 500 (unsupported type)`)
  }
}

/** Resend's API, used directly by product email (credentials, reminders). */
async function checkResend() {
  console.log('\nProduct email sender (Resend API)')
  const apiKey = process.env.RESEND_API_KEY || ''
  const from = (process.env.EMAIL_FROM || '').replace(/^["']|["']$/g, '')
  if (!apiKey || !from) {
    fail(
      `not configured locally (RESEND_API_KEY ${apiKey ? 'set' : 'MISSING'}, EMAIL_FROM ${
        from ? 'set' : 'MISSING'
      })`,
      'employee credentials and visa reminders are sent through this, independently of Supabase SMTP'
    )
    return
  }
  if (!SEND_TO) {
    info(`from ${from} — pass --send <address> to attempt a real delivery`)
    return
  }

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
      'verify the EMAIL_FROM domain in the Resend dashboard'
    )
}

/**
 * The whole flow, for real: create an account through the app's own endpoint.
 * This is the only check that exercises Supabase's SMTP send, because that send
 * happens inside signUp() — if the mail cannot go out, this returns 503.
 */
async function checkEndToEndSignup() {
  console.log('\nEnd-to-end sign-up')
  if (!SIGNUP_AS) {
    info('pass --signup <address> to create a real account and receive a real confirmation email')
    return
  }

  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orgName: 'Auth Doctor',
      fullName: 'Auth Doctor',
      email: SIGNUP_AS,
      password: `Doctor-${crypto.randomBytes(6).toString('hex')}1`,
    }),
    redirect: 'manual',
  })
  const payload = (await res.json().catch(() => null)) as { error?: string; message?: string } | null

  if (res.ok) {
    pass(`sign-up accepted — a confirmation email should be on its way to ${SIGNUP_AS}`)
    info('open the link ON A DIFFERENT DEVICE. It must land on /login with a confirmed message,')
    info('not on an error — that is the check that catches a PKCE `?code=` template.')
  } else if (res.status === 503) {
    fail(
      `sign-up refused with 503: ${payload?.error}`,
      'Supabase could not send the confirmation email. Check Authentication → Emails (SMTP enabled, ' +
        'sender domain verified) and the app log for the [signup] line carrying the GoTrue status.'
    )
  } else if (res.status === 429) {
    info(`rate limited (${payload?.error}) — not a fault, just try again later`)
  } else {
    fail(`sign-up refused with ${res.status}: ${payload?.error || 'no detail'}`)
  }
}

async function main() {
  console.log(`\nAUTH DOCTOR  →  ${BASE}\n`)
  console.log('Auth email is sent by Supabase SMTP; product email by the Resend API.')

  await checkSupabaseSettings()
  await checkConfirmRoute()
  if (CHECK_HOOK) await checkHook()
  await checkResend()
  await checkEndToEndSignup()

  console.log(
    failures === 0
      ? '\nALL CHECKS PASSED.\n'
      : `\n${failures} CHECK(S) FAILED — sign-up and/or password reset are broken.\n`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('\nauth-doctor could not run:', err instanceof Error ? err.message : err)
  process.exit(1)
})
