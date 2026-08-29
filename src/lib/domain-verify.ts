import 'server-only'

/**
 * The network half of domain verification: fetch the org's homepage, read their
 * DNS, and report whether our token is published.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MODULE FETCHES A URL THE USER CHOSE. That is server-side request forgery
 * by construction, and it is the only genuinely dangerous thing in the feature.
 * Everything below exists to keep it pointed at the public internet:
 *
 *   1. The hostname is validated as a NAME first (`normalizeDomain`), so a raw
 *      IP, a port, a path or `file://` never gets this far.
 *   2. Every connection resolves through `guardedLookup`, which drops every
 *      address that is loopback, private, link-local, CGNAT, multicast or
 *      otherwise reserved — in v4 and in v6, including v4-mapped and NAT64
 *      forms, which are the usual way people smuggle 127.0.0.1 past a filter.
 *      Filtering at LOOKUP rather than before the request is what makes it
 *      cover redirects and multi-address hosts too: the socket can only ever be
 *      handed an address this function approved.
 *   3. Redirects are followed BY HAND, capped, and re-validated at every hop.
 *      `fetch`'s automatic following would skip all of the above.
 *   4. The response is capped in bytes and in time, so a hostile site cannot
 *      hold a serverless function open or stream it a gigabyte.
 *   5. HTTPS ONLY, on the first request and on every redirect. A proof read off
 *      a plaintext response proves control of the NETWORK PATH, not of the
 *      domain — see `candidateUrls`.
 *
 * The residual risk is DNS rebinding — a name whose answer changes between our
 * lookup and the socket's. Node gives no supported way to pin the resolved
 * address onto the connection, and the payoff for an attacker is one boolean
 * ("did this page contain a token I already know?"), so the standard mitigation
 * is where this stops.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import dns from 'dns'
import { promises as dnsPromises } from 'dns'
import https from 'https'
import { htmlHasVerificationTag, txtHasVerificationToken, DOMAIN_TXT_PREFIX } from '@/lib/domain'

/** Stop reading a page after this much. The tag lives in `<head>`. */
const MAX_BYTES = 512 * 1024
/** One HTTP attempt. Deliberately short — a live marketing site answers fast. */
const ATTEMPT_TIMEOUT_MS = 6_000
/** The whole check, across both candidate URLs. Must fit inside the route's budget. */
const TOTAL_BUDGET_MS = 14_000
const MAX_REDIRECTS = 3

const USER_AGENT = 'Oneclickhr-DomainVerification/1.0 (+https://app.oneclickhr.app)'

export type VerificationMethod = 'meta' | 'dns'

export type VerifyFailure =
  /** We reached the site and read it, but our tag was not on it. */
  | 'tag_missing'
  /** Nothing answered: DNS failure, connection refused, TLS error, timeout. */
  | 'unreachable'
  /** The name resolves somewhere private. Almost always a misconfiguration. */
  | 'blocked'

export type VerifyResult =
  | { ok: true; method: VerificationMethod; checkedUrl: string }
  | { ok: false; reason: VerifyFailure; checkedUrl: string | null }

class BlockedAddressError extends Error {
  constructor(host: string) {
    super(`Refusing to connect to ${host}: it resolves to a non-public address`)
    this.name = 'BlockedAddressError'
  }
}

// ---------------------------------------------------------------------------
// Address filtering
// ---------------------------------------------------------------------------

/** [first address of the range, prefix length] over the 32-bit v4 space. */
const BLOCKED_V4: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // private
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local — the cloud metadata endpoint lives here
  ['172.16.0.0', 12],    // private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // documentation
  ['192.88.99.0', 24],   // 6to4 relay anycast
  ['192.168.0.0', 16],   // private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // documentation
  ['203.0.113.0', 24],   // documentation
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved, incl. 255.255.255.255
]

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4ToInt(address)
  if (value === null) return false
  for (const [base, bits] of BLOCKED_V4) {
    const baseValue = ipv4ToInt(base)
    if (baseValue === null) continue
    // `>>> 0` keeps the mask unsigned; a /0 shift would otherwise be a no-op.
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    if (((value ^ baseValue) & mask) === 0) return false
  }
  return true
}

/** An IPv6 literal → its eight 16-bit groups, or null if it is not one. */
function ipv6Groups(address: string): number[] | null {
  let value = address.split('%')[0] ?? '' // drop a zone id (fe80::1%eth0)
  if (!value.includes(':')) return null

  // A v4-mapped or NAT64 tail (::ffff:127.0.0.1) — fold it into two groups.
  const tail = value.split(':').pop() ?? ''
  if (tail.includes('.')) {
    const v4 = ipv4ToInt(tail)
    if (v4 === null) return null
    const hex = `${((v4 >>> 16) & 0xffff).toString(16)}:${(v4 & 0xffff).toString(16)}`
    value = `${value.slice(0, value.length - tail.length)}${hex}`
  }

  const halves = value.split('::')
  if (halves.length > 2) return null

  const parse = (part: string): number[] | null => {
    if (!part) return []
    const out: number[] = []
    for (const group of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
      out.push(parseInt(group, 16))
    }
    return out
  }

  const head = parse(halves[0] ?? '')
  const rest = halves.length === 2 ? parse(halves[1] ?? '') : null
  if (!head) return null

  if (halves.length === 1) return head.length === 8 ? head : null
  if (!rest) return null
  const fill = 8 - head.length - rest.length
  if (fill < 0) return null
  return [...head, ...Array(fill).fill(0), ...rest]
}

function isPublicIpv6(address: string): boolean {
  const groups = ipv6Groups(address)
  if (!groups) return false

  const [g0, g1] = groups
  const isZeroPrefix = groups.slice(0, 5).every((g) => g === 0)

  // ::ffff:a.b.c.d (v4-mapped) and 64:ff9b::/96 (NAT64) are the classic ways of
  // writing 127.0.0.1 in v6, so both are unwrapped and judged as v4. Everything
  // else in ::/80 — `::`, `::1`, the deprecated `::a.b.c.d` — is never a real
  // public host.
  if (isZeroPrefix) {
    if (groups[5] === 0xffff) {
      const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
      return isPublicIpv4(v4)
    }
    if (groups[5] === 0) return false
  }
  if (g0 === 0x0064 && g1 === 0xff9b) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`
    return isPublicIpv4(v4)
  }

  if ((g0 & 0xfe00) === 0xfc00) return false // fc00::/7  unique-local
  if ((g0 & 0xffc0) === 0xfe80) return false // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return false // ff00::/8  multicast
  if (g0 === 0x0100 && g1 === 0x0000) return false // 100::/64 discard-only
  if (g0 === 0x2001 && g1 === 0x0db8) return false // 2001:db8::/32 documentation

  return true
}

/** The single question every connection in this module has to answer `true`. */
export function isPublicAddress(address: string): boolean {
  return address.includes(':') ? isPublicIpv6(address) : isPublicIpv4(address)
}

/**
 * A `net.connect` lookup that can only ever hand back a public address.
 *
 * Installed on the request rather than checked beforehand so it also covers
 * redirect hops and hosts with several A records — the socket never sees an
 * address this did not approve.
 */
type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | dns.LookupAddress[],
  family?: number
) => void

function guardedLookup(
  hostname: string,
  options: dns.LookupOneOptions | dns.LookupAllOptions | number,
  callback: LookupCallback
): void {
  const opts = typeof options === 'number' ? { family: options } : (options ?? {})
  const wantsAll = 'all' in opts && opts.all === true

  dns.lookup(hostname, { ...opts, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err)
    const safe = (addresses as dns.LookupAddress[]).filter((a) => isPublicAddress(a.address))
    if (safe.length === 0) return callback(new BlockedAddressError(hostname))
    if (wantsAll) return callback(null, safe)
    return callback(null, safe[0].address, safe[0].family)
  })
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface PageResult {
  status: number
  location: string | null
  body: string
}

/** One request. No redirect following — the caller does that, and re-validates. */
function requestOnce(target: URL, timeoutMs: number): Promise<PageResult> {
  return new Promise((resolve, reject) => {
    // Only https reaches here — `candidateUrls` emits nothing else and every
    // redirect hop is re-checked below.
    const request = https.request(
      target,
      {
        method: 'GET',
        lookup: guardedLookup as never,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          // A cached copy from before the tag was added is the single most
          // common "I added it but it says not found" support ticket.
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0
        const location = (response.headers.location as string | undefined) ?? null

        // A redirect's body is never the page we want, and reading it wastes the
        // budget. Same for a non-HTML 200 — a PDF or an image cannot hold a tag.
        const contentType = String(response.headers['content-type'] ?? '')
        if (location || (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType))) {
          response.destroy()
          resolve({ status, location, body: '' })
          return
        }

        let size = 0
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BYTES) {
            // Enough of `<head>` has gone by; take what we have and stop.
            chunks.push(chunk)
            response.destroy()
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () =>
          resolve({ status, location, body: Buffer.concat(chunks).toString('utf8') })
        )
        response.on('close', () =>
          resolve({ status, location, body: Buffer.concat(chunks).toString('utf8') })
        )
        response.on('error', reject)
      }
    )

    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')))
    request.on('error', reject)
    request.end()
  })
}

/** Follow up to `MAX_REDIRECTS` hops, re-checking the scheme at each one. */
async function fetchPage(startUrl: URL, deadline: number): Promise<string> {
  let target = startUrl

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const remaining = deadline - Date.now()
    if (remaining <= 500) throw new Error('budget exhausted')

    const result = await requestOnce(target, Math.min(ATTEMPT_TIMEOUT_MS, remaining))

    const isRedirect = result.status >= 300 && result.status < 400 && result.location
    if (!isRedirect) {
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`status ${result.status}`)
      }
      return result.body
    }

    const next = new URL(result.location as string, target)
    /*
     * HTTPS at every hop, not just the first.
     *
     * Two separate reasons, and both matter. A redirect to `file:`, `gopher:`
     * or a data URI is where an open redirect turns into a local file read. And
     * a redirect DOWN to plaintext http would quietly undo the https-only rule
     * above — the proof would arrive over a channel anyone on the path can
     * rewrite. Neither is followed.
     */
    if (next.protocol !== 'https:') {
      throw new BlockedAddressError(next.protocol)
    }
    target = next
  }

  throw new Error('too many redirects')
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * URLs to try, best first. HTTPS ONLY — see below.
 *
 * `www.` matters more than it looks: the domain is stored stripped, but a great
 * many companies serve the tag only on the www host and redirect the apex (or
 * the other way round). Trying both is the difference between "it works" and a
 * support ticket.
 *
 * PLAINTEXT HTTP IS NOT ACCEPTED, and this is a security decision, not a
 * convenience one. Over http, anyone able to sit on the path between our server
 * and the site can inject the tag into a response — so a "proof of ownership"
 * gathered over http proves control of the NETWORK, not of the domain, and one
 * hostile network hop would be enough to claim someone else's company. A site
 * that redirects http→https is unaffected; we simply start at https. A site
 * with no TLS at all uses the DNS TXT route instead, which is why it exists.
 */
function candidateUrls(domain: string): URL[] {
  return [new URL(`https://${domain}/`), new URL(`https://www.${domain}/`)]
}

async function checkMetaTag(
  domain: string,
  token: string,
  deadline: number
): Promise<{ found: boolean; reachedAny: boolean; blocked: boolean; lastUrl: string | null }> {
  let reachedAny = false
  let blocked = false
  let lastUrl: string | null = null

  for (const url of candidateUrls(domain)) {
    if (Date.now() > deadline - 1_000) break
    lastUrl = url.origin
    try {
      const html = await fetchPage(url, deadline)
      reachedAny = true
      if (htmlHasVerificationTag(html, token)) {
        return { found: true, reachedAny: true, blocked: false, lastUrl: url.origin }
      }
    } catch (err) {
      if (err instanceof BlockedAddressError) blocked = true
      // Everything else is an ordinary "that host did not answer"; the next
      // candidate may still. Logged at the call site if all of them fail.
    }
  }

  return { found: false, reachedAny, blocked, lastUrl }
}

/**
 * The DNS alternative, for orgs whose site they cannot edit (or who simply
 * prefer it). Both the apex and a `_oneclickhr` subdomain are accepted — the
 * apex is easier to explain, the subdomain is what a DNS admin expects.
 */
async function checkDnsRecord(domain: string, token: string): Promise<boolean> {
  const names = [domain, `_oneclickhr.${domain}`]

  const lookups = await Promise.all(
    names.map(async (name) => {
      try {
        const records = await dnsPromises.resolveTxt(name)
        // A TXT value arrives split into <=255-char chunks; joining them is how
        // the record is actually meant to be read.
        return records.map((chunks) => chunks.join(''))
      } catch {
        return []
      }
    })
  )

  const flat = lookups.flat()
  if (txtHasVerificationToken(flat, token)) return true

  // Some DNS panels quote the value, or the org pasted the tag with the prefix
  // spelled slightly differently. Accept a record that carries our prefix and
  // the exact token, whatever surrounds it.
  return flat.some((record) => {
    const trimmed = record.trim().replace(/^"|"$/g, '')
    return trimmed.startsWith(DOMAIN_TXT_PREFIX) && trimmed.slice(DOMAIN_TXT_PREFIX.length) === token
  })
}

/**
 * Is `token` published on `domain`?
 *
 * `domain` MUST already have been through `normalizeDomain` — this is where an
 * unvalidated string would become an outbound request.
 *
 * Both methods run concurrently so the answer costs the slower of them rather
 * than the sum, and the meta tag wins ties because it is the one we document.
 */
export async function verifyDomainOwnership(domain: string, token: string): Promise<VerifyResult> {
  const deadline = Date.now() + TOTAL_BUDGET_MS

  const [meta, dnsFound] = await Promise.all([
    checkMetaTag(domain, token, deadline),
    checkDnsRecord(domain, token).catch(() => false),
  ])

  if (meta.found) return { ok: true, method: 'meta', checkedUrl: meta.lastUrl ?? `https://${domain}` }
  if (dnsFound) return { ok: true, method: 'dns', checkedUrl: domain }

  if (meta.reachedAny) return { ok: false, reason: 'tag_missing', checkedUrl: meta.lastUrl }
  if (meta.blocked) return { ok: false, reason: 'blocked', checkedUrl: meta.lastUrl }
  return { ok: false, reason: 'unreachable', checkedUrl: meta.lastUrl }
}
