import { describe, it, expect } from 'vitest'
import { totp, verifyTotp, generateTotpSecret, otpauthUrl } from '@/lib/auth/totp'

/**
 * RFC 6238 Appendix B test vectors (SHA-1 variant), truncated to the 6 digits
 * an authenticator app shows. The ASCII secret "12345678901234567890" is
 * GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ in base32. If these pass, the codes this
 * produces are the codes Google Authenticator / 1Password / Authy produce.
 */
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('totp (RFC 6238 vectors)', () => {
  const cases: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ]
  for (const [seconds, expected] of cases) {
    it(`matches at T=${seconds}`, () => {
      expect(totp(RFC_SECRET, seconds * 1000)).toBe(expected)
    })
  }
})

describe('verifyTotp', () => {
  it('accepts the current code', () => {
    const now = 1111111111 * 1000
    expect(verifyTotp(RFC_SECRET, '050471', now)).toBe(true)
  })

  it('accepts a code one step late (clock drift tolerance)', () => {
    const now = 1111111111 * 1000
    // The previous 30-second step's code should still work with window ±1.
    const previous = totp(RFC_SECRET, now - 30_000)
    expect(verifyTotp(RFC_SECRET, previous, now)).toBe(true)
  })

  it('rejects a code two steps away', () => {
    const now = 1111111111 * 1000
    const twoStepsAgo = totp(RFC_SECRET, now - 60_000)
    expect(verifyTotp(RFC_SECRET, twoStepsAgo, now)).toBe(false)
  })

  it('rejects a wrong code, non-numeric input, and the wrong length', () => {
    const now = 1111111111 * 1000
    expect(verifyTotp(RFC_SECRET, '000000', now)).toBe(false)
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false)
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false)
    expect(verifyTotp(RFC_SECRET, '', now)).toBe(false)
  })

  it('tolerates spaces a user might type or paste', () => {
    const now = 1111111111 * 1000
    expect(verifyTotp(RFC_SECRET, '050 471', now)).toBe(true)
  })
})

describe('generateTotpSecret', () => {
  it('produces a 32-character base32 secret that round-trips', () => {
    const secret = generateTotpSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    // A freshly generated secret must yield a verifiable code against itself.
    const code = totp(secret)
    expect(verifyTotp(secret, code)).toBe(true)
  })
})

describe('otpauthUrl', () => {
  it('builds a scannable URI with issuer, account and secret', () => {
    const url = otpauthUrl('ABCDEFGHIJKLMNOP', 'admin@acme.com', 'Acme Inc')
    expect(url.startsWith('otpauth://totp/')).toBe(true)
    expect(url).toContain('secret=ABCDEFGHIJKLMNOP')
    expect(url).toContain('issuer=Acme+Inc')
    expect(decodeURIComponent(url.split('?')[0])).toBe('otpauth://totp/Acme Inc:admin@acme.com')
  })
})
