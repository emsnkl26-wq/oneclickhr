/**
 * Generates a VAPID keypair for web push (035).
 *
 *   npm run push:keys
 *
 * Prints two environment variables. Set BOTH, in every environment that sends
 * notifications, and keep the private one secret — it is what authorizes this
 * application to push to the endpoints its public half minted.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ GENERATE ONCE PER DEPLOYMENT, AND THEN LEAVE IT ALONE.                 │
 * │                                                                        │
 * │ `pushManager.subscribe()` bakes the public key into the endpoint it    │
 * │ returns, so the keypair is part of the identity of every subscription  │
 * │ already in the database. Replace it and all of them become permanently │
 * │ undeliverable — the push service answers 403 for every one, forever,   │
 * │ and no retry or repair fixes it.                                       │
 * │                                                                        │
 * │ If you must rotate: deploy the new pair, then                          │
 * │     delete from public.push_subscriptions;                             │
 * │ and let browsers re-register on their next page load, which            │
 * │ `ensurePushSubscription` does by itself. The client also detects the   │
 * │ mismatch and re-subscribes on its own, so the delete is belt and       │
 * │ braces rather than the only mechanism — but without it the table keeps │
 * │ rows that can never be delivered to.                                   │
 * │                                                                        │
 * │ A staging and a production deployment should have DIFFERENT pairs.     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Uses Node's own crypto rather than `web-push`'s helper so the output can be
 * checked against what src/lib/push/vapid.ts validates: an uncompressed P-256
 * point (65 bytes, 0x04-tagged) and a 32-byte scalar, both base64url.
 */
import { generateKeyPairSync } from 'crypto'

// No `encoding` option, so both come back as KeyObjects rather than PEM strings
// — which is what lets them be exported straight to JWK below.
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })

/*
 * The JWK form is what gives the raw coordinates. The DER/PEM encodings wrap
 * them in ASN.1 that would have to be parsed back out, and the `d`, `x` and `y`
 * members of a JWK are already base64url — which is exactly the encoding the
 * push APIs want.
 */
const priv = privateKey.export({ format: 'jwk' }) as { d?: string }
const pub = publicKey.export({ format: 'jwk' }) as { x?: string; y?: string }

if (!priv.d || !pub.x || !pub.y) {
  console.error('Key generation produced an unexpected JWK. Node 20.9+ is required.')
  process.exit(1)
}

const b64 = (value: string) => Buffer.from(value, 'base64url')

// Uncompressed point: 0x04 || X || Y. Both coordinates are left-padded to 32
// bytes — a JWK may drop a leading zero byte, and a 64-byte point that is
// sometimes 63 bytes is the classic source of "works on my machine" here.
const pad32 = (buf: Buffer) => Buffer.concat([Buffer.alloc(32 - buf.length), buf])

const publicRaw = Buffer.concat([Buffer.from([0x04]), pad32(b64(pub.x)), pad32(b64(pub.y))])
const privateRaw = pad32(b64(priv.d))

const publicB64 = publicRaw.toString('base64url')
const privateB64 = privateRaw.toString('base64url')

// Assert the invariants vapid.ts will check, so a bad pair fails here rather
// than as a silent "push is not configured" at boot.
if (publicRaw.length !== 65 || publicRaw[0] !== 0x04) {
  console.error(`Generated public key is ${publicRaw.length} bytes; expected 65.`)
  process.exit(1)
}
if (privateRaw.length !== 32) {
  console.error(`Generated private key is ${privateRaw.length} bytes; expected 32.`)
  process.exit(1)
}

console.log(`
VAPID keypair generated. Add both to your environment:

NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicB64}
VAPID_PRIVATE_KEY=${privateB64}

Keep VAPID_PRIVATE_KEY secret. Read the header of this script before you ever
replace these — rotating them invalidates every existing subscription.
`)
