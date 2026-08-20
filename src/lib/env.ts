/**
 * Boot-time environment validation. Imported once from the root layout, so it
 * runs a single time per server instance.
 *
 * Contract (§8):
 *   • Never prints a secret VALUE — only the variable name and what's wrong.
 *   • Development: THROWS on a missing/malformed critical var. Fail fast, before
 *     the mistake reaches a deploy.
 *   • Production / `next build`: NEVER throws. A mis-typed optional integration
 *     must not take the whole product down; problems become loud, structured
 *     console.error lines that surface in the Vercel log drain.
 */
import 'server-only'
import { z } from 'zod'

/** Cannot run without these. */
const criticalSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
})

/**
 * An env var set to an empty string is ABSENT, not malformed. A .env file ships
 * with placeholder keys such as SUPABASE_JWT_SECRET=, and a hosting dashboard
 * writes "" for a cleared field — both arrive as "" rather than undefined, which
 * a bare .optional() rejects with a confusing "must contain at least N
 * character(s)" that names a variable the product does not even need.
 */
const blankAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema)

const opt = {
  url: () => blankAsUndefined(z.string().url().optional()),
  str: (min: number) => blankAsUndefined(z.string().min(min).optional()),
}

/**
 * Integrations that degrade gracefully when absent. Shape-validated ONLY when
 * present, so a typo is caught even though absence is allowed.
 */
const optionalSchema = z.object({
  APP_URL: opt.url(),
  NEXT_PUBLIC_APP_URL: opt.url(),
  SUPABASE_JWT_SECRET: opt.str(20),

  RESEND_API_KEY: opt.str(10),
  EMAIL_FROM: opt.str(3),
  SUPABASE_SEND_EMAIL_HOOK_SECRET: opt.str(10),

  R2_ACCOUNT_ID: opt.str(4),
  R2_ACCESS_KEY_ID: opt.str(8),
  R2_SECRET_ACCESS_KEY: opt.str(16),
  R2_BUCKET: opt.str(1),
  R2_ENDPOINT: opt.url(),

  GOOGLE_CLIENT_ID: opt.str(10),
  GOOGLE_CLIENT_SECRET: opt.str(10),
  GOOGLE_REDIRECT_URI: opt.url(),
  GOOGLE_TOKEN_ENCRYPTION_KEY: opt.str(16),

  CRON_SECRET: opt.str(16),
})

/** Cross-field and entropy checks a plain schema cannot express. */
function strengthProblems(env: NodeJS.ProcessEnv): { errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []

  // The AES key is FAIL-CLOSED (see src/lib/crypto.ts): a malformed value is an
  // ERROR, not a warning, because the alternative — silently hashing whatever
  // string was configured — produces a key only as strong as that string while
  // looking like AES-256. If Calendar is configured, this must be right.
  const aesKey = env.GOOGLE_TOKEN_ENCRYPTION_KEY
  if (aesKey) {
    const isHex64 = /^[0-9a-fA-F]{64}$/.test(aesKey)
    let isB64_32 = false
    try {
      isB64_32 = Buffer.from(aesKey, 'base64').length === 32
    } catch {
      /* not base64 */
    }
    if (!isHex64 && !isB64_32) {
      errors.push(
        'GOOGLE_TOKEN_ENCRYPTION_KEY must be 64 hex chars or base64 that decodes to ' +
          'exactly 32 bytes. Encryption FAILS CLOSED on anything else, so Google ' +
          'Calendar will refuse to connect. Generate one with: openssl rand -base64 32'
      )
    }
  }

  const googleParts = [
    ['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET],
    ['GOOGLE_REDIRECT_URI', env.GOOGLE_REDIRECT_URI],
  ] as const
  const googleSet = googleParts.filter(([, v]) => !!v)
  if (googleSet.length > 0 && googleSet.length < googleParts.length) {
    warnings.push(
      `Google Calendar is half-configured (${googleParts
        .filter(([, v]) => !v)
        .map(([k]) => k)
        .join(', ')} missing) — the integration will report not-configured.`
    )
  }
  if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
    warnings.push(
      'GOOGLE_CLIENT_ID is set but GOOGLE_TOKEN_ENCRYPTION_KEY is not — refresh ' +
        'tokens cannot be encrypted, so connecting a calendar will be refused.'
    )
  }

  const r2Parts = [
    ['R2_ACCOUNT_ID', env.R2_ACCOUNT_ID],
    ['R2_ACCESS_KEY_ID', env.R2_ACCESS_KEY_ID],
    ['R2_SECRET_ACCESS_KEY', env.R2_SECRET_ACCESS_KEY],
    ['R2_BUCKET', env.R2_BUCKET],
  ] as const
  const r2Set = r2Parts.filter(([, v]) => !!v)
  if (r2Set.length > 0 && r2Set.length < r2Parts.length) {
    warnings.push(
      `Cloudflare R2 is half-configured (${r2Parts
        .filter(([, v]) => !v)
        .map(([k]) => k)
        .join(', ')} missing) — every upload and download will fail at request time.`
    )
  }

  if (env.RESEND_API_KEY && !env.EMAIL_FROM) {
    warnings.push('RESEND_API_KEY is set but EMAIL_FROM is not — transactional email will not send.')
  }

  if (!env.SUPABASE_SEND_EMAIL_HOOK_SECRET) {
    warnings.push(
      'SUPABASE_SEND_EMAIL_HOOK_SECRET is not set — /api/auth/send-email-hook will reject every ' +
        'call, so unless the Supabase "Send Email" Auth Hook is left disabled, confirmation and ' +
        'password-reset email will fail to send. See SETUP.md §4.'
    )
  }

  // Every confirmation and reset link is built from this. Unset in production,
  // appUrl() falls back to VERCEL_URL — the per-deployment hostname, which is not
  // in the Supabase redirect allowlist and changes on every deploy, so the links
  // in already-delivered email rot.
  if (process.env.NODE_ENV === 'production' && !env.APP_URL && !env.NEXT_PUBLIC_APP_URL) {
    warnings.push(
      'Neither APP_URL nor NEXT_PUBLIC_APP_URL is set — confirmation and password-reset ' +
        'links will be built from the per-deployment VERCEL_URL instead of your real ' +
        'domain. Set APP_URL to the canonical app origin.'
    )
  }

  if (!env.CRON_SECRET) {
    warnings.push(
      'CRON_SECRET is not set — /api/cron/* endpoints answer 503 and the visa ' +
        'reminder engine will never run.'
    )
  }

  return { errors, warnings }
}

let validated = false

export function validateEnv(): void {
  if (validated) return
  validated = true

  const problems: string[] = []

  const critical = criticalSchema.safeParse(process.env)
  if (!critical.success) {
    for (const issue of critical.error.issues) {
      problems.push(`CRITICAL ${issue.path.join('.')}: ${issue.message}`)
    }
  }

  const optional = optionalSchema.safeParse(process.env)
  if (!optional.success) {
    for (const issue of optional.error.issues) {
      problems.push(`${issue.path.join('.')}: ${issue.message}`)
    }
  }

  const { errors, warnings } = strengthProblems(process.env)
  problems.push(...errors)

  if (problems.length === 0 && warnings.length === 0) return

  const header = '[env] environment validation found issues:'
  const lines = [...problems.map((p) => `  ✗ ${p}`), ...warnings.map((w) => `  ⚠ ${w}`)]

  const hasCritical = problems.some((p) => p.startsWith('CRITICAL'))
  if (hasCritical && process.env.NODE_ENV === 'development') {
    throw new Error(`${header}\n${lines.join('\n')}`)
  }

  const log = hasCritical || problems.length ? console.error : console.warn
  log(`${header}\n${lines.join('\n')}`)
}

/** Absolute base URL for links in emails and OAuth redirects. */
export function appUrl(): string {
  const raw =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    'http://localhost:3000'
  return raw.replace(/\/+$/, '')
}

validateEnv()
