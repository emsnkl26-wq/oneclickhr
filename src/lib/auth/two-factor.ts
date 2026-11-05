import 'server-only'

/**
 * The server side of organization two-step verification (064).
 *
 * TWO halves live here:
 *
 *   1. The DATABASE row — is this admin enrolled, and what is their (decrypted)
 *      TOTP secret. Read on the caller's own session, so RLS already guarantees
 *      they can only ever see their own.
 *
 *   2. The PROOF COOKIE — a short-lived, signed token that says "this person
 *      passed a code at such-and-such a time, good until <expiry>". The gate in
 *      src/lib/auth/guards.ts trusts it, so it is HMAC-signed with a server-only
 *      secret and bound to the profile id; a forged or copied cookie fails the
 *      signature, and one admin's cookie is useless to another.
 *
 * The cookie is what makes "ask again every 8 hours" work without a second
 * database round trip on every navigation: its expiry IS the window, baked in
 * when it was issued, so the gate only has to check a signature and a clock.
 */
import { cookies } from 'next/headers'
import crypto from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { encryptToken, decryptToken } from '@/lib/crypto'

export const TWO_FACTOR_COOKIE = 'nk_2fa'
/**
 * Where an org admin is parked until they enter a current code. TOP-LEVEL, not
 * under /org, so the org layout's own guard cannot bounce them in a loop — the
 * same shape as /change-password.
 */
export const TWO_FACTOR_VERIFY_PATH = '/verify-2fa'
/** Shown to the browser when an API call is blocked pending verification. */
export const TWO_FACTOR_REQUIRED_MESSAGE =
  'Two-step verification required. Enter the code from your authenticator app.'

export const DEFAULT_WINDOW_HOURS = 8
const MIN_WINDOW_HOURS = 1
const MAX_WINDOW_HOURS = 720

export interface TwoFactorRecord {
  enabled: boolean
  secret: string
}

/**
 * The HMAC key for the proof cookie. Never leaves the server and is not the
 * value stored in the cookie, so using the service-role key as the key material
 * reveals nothing about it. A dedicated `TWO_FACTOR_COOKIE_SECRET` takes
 * precedence when set.
 */
function cookieSecret(): string {
  const secret = process.env.TWO_FACTOR_COOKIE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) {
    throw new Error(
      'Two-step verification cannot sign its session: set SUPABASE_SERVICE_ROLE_KEY (or TWO_FACTOR_COOKIE_SECRET).'
    )
  }
  return secret
}

/** Clamp a requested window to the allowed range, falling back to the default. */
export function normalizeWindowHours(value: number | null | undefined): number {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return DEFAULT_WINDOW_HOURS
  return Math.min(MAX_WINDOW_HOURS, Math.max(MIN_WINDOW_HOURS, n))
}

/* ------------------------------------------------------------- the DB row */

/**
 * This user's 2FA record with the secret decrypted, or null if they have none.
 *
 * Runs on `supabase` (the caller's session), so RLS limits it to their own row.
 * A row whose secret cannot be decrypted is treated as absent rather than
 * throwing — a broken key must not wedge the gate — but that is logged.
 */
export async function readTwoFactor(
  supabase: SupabaseClient,
  profileId: string
): Promise<TwoFactorRecord | null> {
  const { data, error } = await supabase
    .from('user_two_factor')
    .select('enabled, secret_enc')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error || !data) return null
  try {
    return { enabled: !!data.enabled, secret: decryptToken(data.secret_enc as string) }
  } catch (err) {
    console.error('[2fa] could not decrypt stored secret for', profileId, err)
    return null
  }
}

/** Is two-step verification switched ON for this user? Cheap: no decryption. */
export async function isTwoFactorEnabled(
  supabase: SupabaseClient,
  profileId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('user_two_factor')
    .select('enabled')
    .eq('profile_id', profileId)
    .maybeSingle()
  return !!(data as { enabled: boolean } | null)?.enabled
}

/** Encrypt a freshly generated secret for storage. */
export function encryptSecret(secret: string): string {
  return encryptToken(secret)
}

/** The org's re-prompt window in hours, clamped, defaulting to 8 if unset. */
export async function readWindowHours(
  supabase: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { data } = await supabase
    .from('tenants')
    .select('two_factor_window_hours')
    .eq('id', tenantId)
    .maybeSingle()
  return normalizeWindowHours((data as { two_factor_window_hours: number } | null)?.two_factor_window_hours)
}

/* ------------------------------------------------------------ the cookie */

function sign(payload: string): string {
  return crypto.createHmac('sha256', cookieSecret()).update(payload).digest('hex')
}

/** `<profileId>.<expiresAtMs>.<hmac>` — self-describing and tamper-evident. */
export function makeProofCookie(profileId: string, windowHours: number): { value: string; maxAgeSeconds: number } {
  const hours = normalizeWindowHours(windowHours)
  const maxAgeSeconds = hours * 3600
  const expiresAt = Date.now() + maxAgeSeconds * 1000
  const payload = `${profileId}.${expiresAt}`
  return { value: `${payload}.${sign(payload)}`, maxAgeSeconds }
}

/** True only for a cookie this server signed, for THIS user, not yet expired. */
export function verifyProofCookie(raw: string | undefined, profileId: string): boolean {
  if (!raw) return false
  const parts = raw.split('.')
  if (parts.length !== 3) return false
  const [id, expStr, mac] = parts
  if (id !== profileId) return false

  const expected = sign(`${id}.${expStr}`)
  const macBuf = Buffer.from(mac)
  const expBuf = Buffer.from(expected)
  if (macBuf.length !== expBuf.length || !crypto.timingSafeEqual(macBuf, expBuf)) return false

  const expiresAt = Number(expStr)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false
  return true
}

/**
 * Has this user already passed 2FA within the window? Reads the request's
 * cookies, so it is free of any database work.
 */
export async function hasValidProof(profileId: string): Promise<boolean> {
  const store = await cookies()
  return verifyProofCookie(store.get(TWO_FACTOR_COOKIE)?.value, profileId)
}

/**
 * Write the proof cookie after a successful enrol/verify. httpOnly so script
 * can never read it, `sameSite=lax` and `secure` in production.
 */
export async function setProofCookie(profileId: string, windowHours: number): Promise<void> {
  const { value, maxAgeSeconds } = makeProofCookie(profileId, windowHours)
  const store = await cookies()
  store.set(TWO_FACTOR_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  })
}

/** Drop the proof cookie — on disabling 2FA, so the next page re-evaluates cleanly. */
export async function clearProofCookie(): Promise<void> {
  const store = await cookies()
  store.set(TWO_FACTOR_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}
