import 'server-only'

/**
 * VAPID identity — the keypair that proves to a push service that pushes for
 * this application come from this application.
 *
 * WHAT VAPID ACTUALLY IS, because the name suggests more than it does. It is an
 * ES256-signed JWT the server attaches to every push request, identifying the
 * SENDER to Google/Mozilla/Apple's push infrastructure. It is not what encrypts
 * the payload — that is done with the subscription's own `p256dh`/`auth` keys
 * (RFC 8291), per browser, and the push service cannot read it. So the private
 * key here does not protect message CONTENT; it protects the right to send to
 * subscriptions minted against its public half.
 *
 * THE PUBLIC KEY IS PART OF THE SUBSCRIPTION'S IDENTITY, and that is the one
 * operational fact that catches people out. `pushManager.subscribe()` bakes the
 * `applicationServerKey` into the endpoint it returns. Rotate the keypair and
 * every subscription already in the database becomes undeliverable — the push
 * service answers 403 forever, because those endpoints belong to the old key.
 * Rotation therefore means: deploy the new pair, delete every row in
 * `push_subscriptions`, and let browsers re-subscribe on their next page load
 * (which `ensurePushSubscription` does automatically). There is no migration
 * path that preserves them, so this is documented rather than automated.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THIS MODULE FAILS CLOSED, and it is deliberately louder about it than  │
 * │ the surrounding code usually is.                                       │
 * │                                                                        │
 * │ A half-configured or malformed keypair cannot produce a valid JWT, so  │
 * │ EVERY push would fail — one silent 403 per notification per device,    │
 * │ forever, while the product reports itself healthy. Rather than let      │
 * │ that happen, a malformed value makes `isPushConfigured()` answer false: │
 * │ push is reported OFF, the UI stops asking people for permission it     │
 * │ cannot use, and `validateEnv()` prints exactly what is wrong with which │
 * │ variable. Off and honest beats on and broken.                          │
 * └────────────────────────────────────────────────────────────────────────┘
 */

export interface VapidConfig {
  publicKey: string
  privateKey: string
  /** `mailto:` or `https:` — the push service uses it to contact the sender. */
  subject: string
}

/**
 * A P-256 public key in uncompressed point form is exactly 65 bytes and begins
 * with the 0x04 tag; base64url that is 87 or 88 characters. Checking the DECODED
 * shape rather than the string length catches the common paste errors that a
 * length check alone waves through — a truncated key, a base64 (`+/=`) key
 * pasted where base64url was wanted, or the private key put in the public slot.
 */
function decodeBase64Url(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const buf = Buffer.from(value, 'base64url')
    // Round-trip: base64url decoding is lenient and will happily swallow a
    // string that is not canonical. If re-encoding does not reproduce the input
    // we were given something other than what we think.
    return buf.toString('base64url') === value.replace(/=+$/, '') ? buf : null
  } catch {
    return null
  }
}

export function publicKeyProblem(value: string | undefined): string | null {
  if (!value) return null // absent is a separate, non-error state
  const decoded = decodeBase64Url(value.trim())
  if (!decoded) {
    return 'NEXT_PUBLIC_VAPID_PUBLIC_KEY is not valid base64url (it must not contain +, / or =).'
  }
  if (decoded.length !== 65 || decoded[0] !== 0x04) {
    return (
      'NEXT_PUBLIC_VAPID_PUBLIC_KEY must be an uncompressed P-256 point: 65 bytes ' +
      `starting with 0x04, got ${decoded.length} bytes. Generate a pair with: npm run push:keys`
    )
  }
  return null
}

export function privateKeyProblem(value: string | undefined): string | null {
  if (!value) return null
  const decoded = decodeBase64Url(value.trim())
  if (!decoded) {
    return 'VAPID_PRIVATE_KEY is not valid base64url (it must not contain +, / or =).'
  }
  if (decoded.length !== 32) {
    return (
      `VAPID_PRIVATE_KEY must be a 32-byte P-256 scalar, got ${decoded.length} bytes. ` +
      'Generate a pair with: npm run push:keys'
    )
  }
  return null
}

/**
 * The `sub` claim. A push service treats it as the address to contact if this
 * sender starts misbehaving, so it must be a real `mailto:`/`https:` URI.
 *
 * Derived rather than required: EMAIL_FROM is already a deliverable address this
 * deployment owns, and APP_URL is already its canonical origin. Asking an
 * operator to configure a third value that must agree with both is a way to end
 * up with one that does not. An explicit VAPID_SUBJECT still wins when set.
 *
 * EMAIL_FROM may be `Name <a@b.com>`; only the address inside the angle
 * brackets is a valid mailto target.
 */
function resolveSubject(): string {
  const explicit = process.env.VAPID_SUBJECT?.trim()
  if (explicit && /^(mailto:|https:\/\/)/i.test(explicit)) return explicit

  const from = process.env.EMAIL_FROM?.trim()
  if (from) {
    const bracketed = from.match(/<([^>]+)>/)
    const address = (bracketed ? bracketed[1] : from).trim()
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return `mailto:${address}`
  }

  const url = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (url && /^https:\/\//i.test(url)) return url.replace(/\/+$/, '')

  // Last resort. Valid as a URI, which is all the JWT needs to be accepted; a
  // deployment that reaches this line has neither an email nor a public origin
  // configured, and has larger problems than its push contact address.
  return 'mailto:noreply@oneclickhr.app'
}

let cached: VapidConfig | null | undefined

/**
 * The validated pair, or null when push is not usable. Memoized per server
 * instance — the validation is cheap but runs on every single send, and the
 * environment cannot change under a running process.
 */
export function vapidConfig(): VapidConfig | null {
  if (cached !== undefined) return cached

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()

  if (!publicKey || !privateKey) {
    cached = null
    return cached
  }
  if (publicKeyProblem(publicKey) || privateKeyProblem(privateKey)) {
    // The specific complaint is printed once, by validateEnv() at boot. Repeating
    // it per send would bury the log under identical lines.
    cached = null
    return cached
  }

  cached = { publicKey, privateKey, subject: resolveSubject() }
  return cached
}

export function isPushConfigured(): boolean {
  return vapidConfig() !== null
}

/**
 * The public key the BROWSER needs to call `pushManager.subscribe()`.
 *
 * Served to the client from /api/push/config rather than read from
 * `process.env.NEXT_PUBLIC_*` in the component. Both are public values, so this
 * is not about secrecy — it is about a stale one. A `NEXT_PUBLIC_` variable is
 * inlined at BUILD time, so changing it in the hosting dashboard has no effect
 * until something triggers a rebuild, and in the meantime browsers subscribe
 * against a key the server no longer holds and every push 403s. Reading it at
 * REQUEST time means the server's answer and the server's key are the same fact.
 */
export function publicVapidKey(): string | null {
  return vapidConfig()?.publicKey ?? null
}
