import { describe, it, expect } from 'vitest'
import {
  normalizeDomain, domainProblem, htmlHasVerificationTag, txtHasVerificationToken,
  metaTagFor, txtRecordFor, aiPromptFor, DOMAIN_META_NAME,
  domainsConflict, parentDomains, daysUntilDeadline, deadlineLabel,
} from '@/lib/domain'
import { isPublicAddress } from '@/lib/domain-verify'

const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'

/**
 * Normalization is the join key of the whole feature: the signup form, the
 * settings form, the uniqueness index and the outbound fetch all have to agree
 * on what a person's typing means, or a domain someone verified stops matching
 * the row it was verified against.
 */
describe('normalizeDomain', () => {
  it('reduces every spelling of one company to the same host', () => {
    const expected = 'acme.com'
    for (const input of [
      'acme.com',
      'ACME.com',
      '  Acme.Com  ',
      'www.acme.com',
      'https://acme.com',
      'http://www.acme.com',
      'https://www.ACME.com/careers?ref=x',
      'https://acme.com:8443/',
      'acme.com.',
      'https://user:pass@acme.com/',
    ]) {
      expect(normalizeDomain(input), input).toBe(expected)
    }
  })

  it('keeps a subdomain that is not www', () => {
    expect(normalizeDomain('https://careers.acme.co.uk/jobs')).toBe('careers.acme.co.uk')
  })

  it('refuses anything that is not a hostname', () => {
    for (const input of [
      '', '   ', 'acme', 'localhost', '.com', 'acme..com', 'ac me.com',
      '-acme.com', 'acme-.com', 'https://', 'http:///path', 'a'.repeat(300) + '.com',
    ]) {
      expect(normalizeDomain(input), input).toBeNull()
    }
  })

  // A bare IP is both meaningless as a "company website" and the usual first
  // move in an SSRF attempt, so it is refused before anything can dial it.
  it('refuses IP addresses', () => {
    for (const input of ['127.0.0.1', 'http://169.254.169.254/', '10.0.0.1', '0.0.0.0']) {
      expect(normalizeDomain(input), input).toBeNull()
    }
  })
})

describe('domainProblem', () => {
  it('accepts a real company site', () => {
    expect(domainProblem('https://www.acme.com')).toBeNull()
  })

  it('names the mistake instead of just failing', () => {
    expect(domainProblem('')).toMatch(/enter your company website/i)
    expect(domainProblem('not a domain')).toMatch(/valid website/i)
  })

  // The predictable mistake: typing the email domain into "company website".
  // It can never be verified, so it is caught at the point of entry.
  it('rejects free mailbox providers', () => {
    for (const input of ['gmail.com', 'https://www.outlook.com', 'YAHOO.com']) {
      expect(domainProblem(input), input).toMatch(/own website/i)
    }
  })

  it('rejects hostnames that cannot exist on the public internet', () => {
    for (const input of ['acme.local', 'server.internal', 'foo.test']) {
      expect(domainProblem(input), input).toMatch(/public internet/i)
    }
  })
})

/**
 * The tag has to be parsed, not searched for. A page that merely QUOTES someone
 * else's token — a docs page, a forum thread, a public paste — must not verify
 * the person who quoted it.
 */
describe('htmlHasVerificationTag', () => {
  const found = (html: string) => htmlHasVerificationTag(html, TOKEN)

  it('finds the tag we tell people to paste', () => {
    expect(found(`<head>${metaTagFor(TOKEN)}</head>`)).toBe(true)
  })

  it('tolerates how real HTML actually varies', () => {
    expect(found(`<META NAME="${DOMAIN_META_NAME}" CONTENT="${TOKEN}">`)).toBe(true)
    expect(found(`<meta content='${TOKEN}' name='${DOMAIN_META_NAME}'>`)).toBe(true)
    expect(found(`<meta   name = "${DOMAIN_META_NAME}"\n  content = "${TOKEN}" />`)).toBe(true)
    expect(found(`<meta name=${DOMAIN_META_NAME} content=${TOKEN}>`)).toBe(true)
  })

  it('does not accept the token merely appearing on the page', () => {
    expect(found(`<p>Our token is ${TOKEN}</p>`)).toBe(false)
    expect(found(`<meta name="description" content="${TOKEN}">`)).toBe(false)
    expect(found(`<!-- ${metaTagFor(TOKEN).replace('<meta', 'x')} -->`)).toBe(false)
  })

  it('requires the exact token', () => {
    expect(found(`<meta name="${DOMAIN_META_NAME}" content="${TOKEN}x">`)).toBe(false)
    expect(found(`<meta name="${DOMAIN_META_NAME}" content="${TOKEN.slice(0, -1)}">`)).toBe(false)
    expect(found(`<meta name="${DOMAIN_META_NAME}" content="">`)).toBe(false)
  })

  it('is false for an empty page or an empty token', () => {
    expect(found('')).toBe(false)
    expect(htmlHasVerificationTag(metaTagFor(TOKEN), '')).toBe(false)
  })
})

describe('txtHasVerificationToken', () => {
  it('matches the record we hand out', () => {
    expect(txtHasVerificationToken(['v=spf1 -all', txtRecordFor(TOKEN)], TOKEN)).toBe(true)
  })

  it('ignores unrelated and near-miss records', () => {
    expect(txtHasVerificationToken(['v=spf1 -all', TOKEN], TOKEN)).toBe(false)
    expect(txtHasVerificationToken([txtRecordFor('other')], TOKEN)).toBe(false)
  })
})

/**
 * The subdomain rule is the second half of "one company, one workspace".
 * Without it, two people from Acme can verify `acme.com` and `careers.acme.com`
 * and end up with exactly the two disconnected workspaces the feature exists to
 * prevent — the unique index cannot see it, because to Postgres those are two
 * unrelated strings.
 */
describe('domainsConflict', () => {
  it('treats a domain and its subdomains as one company', () => {
    expect(domainsConflict('acme.com', 'acme.com')).toBe(true)
    expect(domainsConflict('careers.acme.com', 'acme.com')).toBe(true)
    expect(domainsConflict('acme.com', 'careers.acme.com')).toBe(true)
    expect(domainsConflict('a.b.acme.com', 'acme.com')).toBe(true)
  })

  it('leaves genuinely different companies alone', () => {
    expect(domainsConflict('acme.com', 'acme.net')).toBe(false)
    expect(domainsConflict('acme.com', 'notacme.com')).toBe(false)
    // The near-miss that a naive `endsWith` gets wrong: no dot boundary.
    expect(domainsConflict('myacme.com', 'acme.com')).toBe(false)
    expect(domainsConflict('acme.com', 'acme.com.evil.net')).toBe(false)
  })

  it('is false when either side is missing', () => {
    expect(domainsConflict('', 'acme.com')).toBe(false)
    expect(domainsConflict('acme.com', '')).toBe(false)
  })
})

describe('parentDomains', () => {
  it('walks up to but not past the last two labels', () => {
    expect(parentDomains('careers.acme.co.uk')).toEqual(['acme.co.uk', 'co.uk'])
    expect(parentDomains('acme.com')).toEqual([])
    expect(parentDomains('a.b.c.com')).toEqual(['b.c.com', 'c.com'])
  })

  it('produces only real parents of the input', () => {
    for (const parent of parentDomains('a.b.acme.co.uk')) {
      expect(domainsConflict('a.b.acme.co.uk', parent)).toBe(true)
    }
  })
})

describe('daysUntilDeadline / deadlineLabel', () => {
  const now = Date.UTC(2026, 7, 28, 12, 0, 0)
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString()
  const DAY = 86_400_000

  it('rounds up, so a deadline later today is still a day left', () => {
    expect(daysUntilDeadline(at(12 * 3600_000), now)).toBe(1)
    expect(daysUntilDeadline(at(14 * DAY), now)).toBe(14)
  })

  it('goes negative once the deadline has passed', () => {
    expect(daysUntilDeadline(at(-2 * DAY), now)).toBe(-2)
    expect(deadlineLabel(-2)).toBe('overdue by 2 days')
    expect(deadlineLabel(-1)).toBe('overdue by 1 day')
  })

  it('has no deadline when none is recorded, and never throws on junk', () => {
    expect(daysUntilDeadline(null, now)).toBeNull()
    expect(daysUntilDeadline('', now)).toBeNull()
    expect(daysUntilDeadline('not a date', now)).toBeNull()
  })

  it('reads naturally at every boundary', () => {
    expect(deadlineLabel(0)).toBe('due today')
    expect(deadlineLabel(1)).toBe('1 day left')
    expect(deadlineLabel(9)).toBe('9 days left')
  })
})

describe('aiPromptFor', () => {
  it('carries the literal tag and the domain it belongs on', () => {
    const prompt = aiPromptFor('acme.com', TOKEN)
    expect(prompt).toContain(metaTagFor(TOKEN))
    expect(prompt).toContain('https://acme.com/')
    // Without this, an assistant helpfully "generates" its own token.
    expect(prompt).toMatch(/do not generate/i)
  })
})

/**
 * The SSRF filter. Every one of these is a real way people reach a metadata
 * endpoint or a service on localhost through a URL-fetching feature, and the
 * v6 spellings are the ones a naive string check misses.
 */
describe('isPublicAddress', () => {
  it('allows ordinary public addresses', () => {
    for (const ip of ['1.1.1.1', '93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
      expect(isPublicAddress(ip), ip).toBe(true)
    }
  })

  it('blocks every reserved IPv4 range', () => {
    for (const ip of [
      '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '127.1.2.3',
      '169.254.169.254', // the cloud metadata endpoint
      '172.16.0.1', '172.31.255.254', '192.0.2.5', '192.168.1.1',
      '198.18.0.1', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })

  it('does not treat a public-looking neighbour of a blocked range as blocked', () => {
    expect(isPublicAddress('172.32.0.1')).toBe(true)   // just past 172.16/12
    expect(isPublicAddress('100.128.0.1')).toBe(true)  // just past 100.64/10
    expect(isPublicAddress('11.0.0.1')).toBe(true)     // just past 10/8
  })

  it('blocks the IPv6 spellings of the same addresses', () => {
    for (const ip of [
      '::1', '::', 'fe80::1', 'fe80::1%eth0', 'fc00::1', 'fd12:3456::1', 'ff02::1',
      '::ffff:127.0.0.1',   // v4-mapped loopback
      '::ffff:169.254.169.254',
      '64:ff9b::127.0.0.1', // NAT64 loopback
      '2001:db8::1',        // documentation
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })

  it('unwraps a v4-mapped PUBLIC address rather than blocking it outright', () => {
    expect(isPublicAddress('::ffff:1.1.1.1')).toBe(true)
  })

  it('refuses anything it cannot parse', () => {
    for (const ip of ['', 'not-an-ip', '1.2.3', '1.2.3.4.5', '999.1.1.1', 'gg::1']) {
      expect(isPublicAddress(ip), ip).toBe(false)
    }
  })
})
