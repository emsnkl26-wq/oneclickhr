import 'server-only'

/**
 * Time-based one-time passwords (TOTP, RFC 6238) for authenticator-app 2FA.
 *
 * Implemented on Node's `crypto` rather than a dependency: TOTP is a HMAC and a
 * modulo, the interop surface is just "what Google Authenticator / 1Password /
 * Authy already do", and those are fixed — SHA-1, a 30-second step and 6 digits.
 * Writing it here keeps the one security-sensitive primitive in the tree where
 * it can be read, instead of trusting an unaudited transitive package.
 *
 * The shared secret is generated here, handed to the user once (as a QR and as
 * the base32 string), and stored ENCRYPTED (src/lib/crypto.ts). Verification
 * reads it back, decrypts it, and compares codes with a small time window so a
 * clock a step out of sync still works.
 */
import crypto from 'crypto'

const DIGITS = 6
const PERIOD_SECONDS = 30
const ALGORITHM = 'sha1'

/* ----------------------------------------------------------------- base32 */
// RFC 4648 alphabet, no padding — the form every authenticator app expects.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(buffer: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of buffer) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) continue // tolerate stray separators a user might paste
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/* --------------------------------------------------------------- generate */

/** A fresh 160-bit secret, as the base32 string an authenticator is seeded with. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20))
}

/** The HOTP/TOTP code for one counter value. */
function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret)
  const buffer = Buffer.alloc(8)
  // 64-bit big-endian counter. Written as two 32-bit halves because bitwise
  // maths in JS is 32-bit; the high half is safe for any realistic timestamp.
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buffer.writeUInt32BE(counter >>> 0, 4)

  const hmac = crypto.createHmac(ALGORITHM, key).update(buffer).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/** The code for the current 30-second step (used only in tests / tooling). */
export function totp(secret: string, atMs: number = Date.now()): string {
  return hotp(secret, Math.floor(atMs / 1000 / PERIOD_SECONDS))
}

/**
 * Is `token` a valid code for `secret` right now?
 *
 * Checks the current step and `window` steps either side (default ±1, i.e. a
 * 90-second tolerance) so a phone clock slightly out of sync still works.
 * The comparison is length-checked and constant-time against each candidate so
 * nothing about the real code leaks through timing.
 */
export function verifyTotp(
  secret: string,
  token: string,
  atMs: number = Date.now(),
  window = 1
): boolean {
  const cleaned = (token || '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  if (!secret) return false

  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS)
  let matched = false
  for (let error = -window; error <= window; error++) {
    const candidate = hotp(secret, counter + error)
    // Compare every candidate even once matched, so timing is independent of
    // which step (if any) was the right one.
    if (timingSafeEqualStr(candidate, cleaned)) matched = true
  }
  return matched
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * The `otpauth://` URI an authenticator reads from a QR code.
 *
 * `issuer` is the workspace/product name shown in the app; `account` is the
 * admin's email, so someone with several accounts can tell them apart.
 */
export function otpauthUrl(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}
