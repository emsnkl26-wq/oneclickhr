/**
 * The organization's short prefix, and the codes built on top of it.
 *
 * WHY THIS EXISTS. Generated identifiers used to read `EMP-0001` / `INV-0001` —
 * the product's naming, not the organization's. Companies already have a short
 * form on their badges and paperwork ("NKL" for Nextkin Life), so signup asks
 * for it once and everything generated afterwards reads the way the rest of
 * their filing does: `NKL-0001`, `NKL-INV-0001`.
 *
 * NO DIRECTIVE AT THE TOP, ON PURPOSE — no `'use client'`, no `server-only`.
 * The signup form previews the derived code in the browser while API handlers
 * mint the real ones, so both sides import this. Same reasoning as src/lib/geo.ts.
 *
 * `deriveOrgCode` MIRRORS `public.org_code_from()` in 031_org_code.sql. Keep the
 * two in step: the SQL one is what actually runs at provisioning time, and this
 * one only decides what the signup field shows as a placeholder. A drift makes
 * the preview a lie, not a bug in the data.
 */

/** Legal-form and filler words that carry no signal in an abbreviation. */
const NOISE = new Set([
  'LLC', 'INC', 'LTD', 'LIMITED', 'CORP', 'CORPORATION', 'PVT', 'PRIVATE',
  'GMBH', 'PLC', 'CO', 'COMPANY', 'THE', 'AND',
])

export const ORG_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/

/**
 * A suggested code for an organization name, or null when none can be made.
 *
 * Initials for a multi-word name, the first three letters for a single word.
 * Null is a normal answer, not a failure: the caller falls back to the old
 * `EMP-` series rather than inventing something unrecognisable.
 */
export function deriveOrgCode(name: string | null | undefined): string | null {
  const words = (name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && !NOISE.has(word))

  if (words.length === 0) return null

  const code = words.length === 1 ? words[0].slice(0, 3) : words.map((w) => w[0]).join('').slice(0, 6)

  return ORG_CODE_PATTERN.test(code) ? code : null
}

/**
 * `NKL-0007`, or `EMP-0007` for a workspace with no code.
 *
 * The number is zero-padded to four so codes sort as text in a spreadsheet,
 * which is where most orgs end up looking at them.
 */
export function employeeCodeFor(orgCode: string | null | undefined, n: number): string {
  return `${orgCode || 'EMP'}-${String(n).padStart(4, '0')}`
}

/** `NKL-INV-0007`, or `INV-0007` for a workspace with no code. */
export function invoiceNumberFor(orgCode: string | null | undefined, n: number): string {
  const serial = `INV-${String(n).padStart(4, '0')}`
  return orgCode ? `${orgCode}-${serial}` : serial
}
