import { describe, it, expect } from 'vitest'
import { deriveOrgCode, employeeCodeFor, invoiceNumberFor } from '@/lib/org-code'

/**
 * These assertions double as the contract with `public.org_code_from()` in
 * 031_org_code.sql. The SQL function is what actually runs at provisioning
 * time; this one only draws the suggestion in the signup field, so a drift
 * between them shows up as a placeholder that lies about what will be saved.
 */
describe('deriveOrgCode', () => {
  it('takes the initials of a multi-word name', () => {
    expect(deriveOrgCode('Nextkin Life')).toBe('NL')
    expect(deriveOrgCode('Acme Health Systems')).toBe('AHS')
  })

  it('drops the legal form, which carries no signal', () => {
    expect(deriveOrgCode('Acme Health LLC')).toBe('AH')
    expect(deriveOrgCode('Acme Inc')).toBe('ACM')
  })

  it('takes the first three letters of a single-word name', () => {
    expect(deriveOrgCode('Stripe')).toBe('STR')
  })

  it('ignores punctuation rather than abbreviating it', () => {
    expect(deriveOrgCode('Smith & Sons, Ltd.')).toBe('SS')
  })

  it('caps the code at six characters', () => {
    expect(deriveOrgCode('A B C D E F G H')).toBe('ABCDEF')
  })

  it('returns null when no valid code can be made', () => {
    // Nothing left after the noise words, a leading digit, and too short.
    expect(deriveOrgCode('The Company')).toBeNull()
    expect(deriveOrgCode('3M')).toBeNull()
    expect(deriveOrgCode('X')).toBeNull()
    expect(deriveOrgCode('')).toBeNull()
    expect(deriveOrgCode(null)).toBeNull()
  })
})

describe('code formatting', () => {
  it('prefixes with the org code when there is one', () => {
    expect(employeeCodeFor('NKL', 7)).toBe('NKL-0007')
    expect(invoiceNumberFor('NKL', 7)).toBe('NKL-INV-0007')
  })

  /**
   * The workspaces that predate 031 have live `EMP-`/`INV-` codes on signed
   * paperwork. Falling back to the original series is what stops a second,
   * parallel numbering from starting up beside them.
   */
  it('falls back to the original series without one', () => {
    expect(employeeCodeFor(null, 7)).toBe('EMP-0007')
    expect(invoiceNumberFor(undefined, 7)).toBe('INV-0007')
  })
})
