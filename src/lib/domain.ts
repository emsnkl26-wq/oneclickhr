/**
 * Company-domain identity: normalization, validation, and the exact strings the
 * org has to publish.
 *
 * Deliberately PURE and free of `server-only`. The signup form, the verification
 * page, the API handlers and the tests all have to agree on what `Acme.COM/`
 * normalizes to; if that answer differed by a single character between the
 * client and the server, a domain someone verified would stop matching the one
 * we stored.
 *
 * The network side of verification — fetching the site, reading DNS — lives in
 * `domain-verify.ts`, which is server-only. Nothing here touches the network.
 */

/** The `name` of the meta tag an org puts on their homepage. */
export const DOMAIN_META_NAME = 'oneclickhr-domain-verification'

/** The prefix of the TXT record, for orgs who would rather use DNS. */
export const DOMAIN_TXT_PREFIX = 'oneclickhr-domain-verification='

/**
 * Free mailbox providers. Someone typing their email domain into a field
 * labelled "company website" is a predictable mistake, and it is one they can
 * never verify — better to say so at the point of entry than to leave them
 * staring at a banner they cannot clear.
 */
const MAILBOX_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
  'aol.com', 'protonmail.com', 'proton.me', 'zoho.com', 'gmx.com', 'mail.com',
  'yandex.com', 'rediffmail.com', 'qq.com', '163.com',
])

/** Hostnames that can never be a public company website. */
const RESERVED_SUFFIXES = [
  '.local', '.localhost', '.internal', '.intranet', '.lan', '.home', '.corp',
  '.test', '.example', '.invalid', '.onion',
]

/** One hostname label: alphanumeric ends, hyphens allowed inside, 1-63 chars. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Anything a person might paste into "company website" → the bare host we store.
 *
 * `https://WWW.Acme.com:443/careers?ref=x` and `acme.com` are the same company,
 * so they must produce the same string. Returns null when the input cannot be
 * read as a hostname at all — the caller turns that into a message.
 *
 * `www.` is stripped, and that is the one piece of guesswork here. It is worth
 * it: `www.acme.com` and `acme.com` are the same organization in every case
 * that matters, and leaving both spellings valid would let the same company
 * hold two verified slots — the exact duplicate this feature exists to stop.
 */
export function normalizeDomain(input: string): string | null {
  let value = (input ?? '').trim().toLowerCase()
  if (!value) return null

  // Strip a scheme, then anything after the authority. Done by hand rather than
  // with `new URL()` because the common input is `acme.com`, which URL rejects,
  // and prefixing a scheme to make it parse would happily accept `a b/c`.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  value = value.split(/[/?#\\]/)[0] ?? ''
  // Credentials (`user:pass@host`) and a port.
  value = value.split('@').pop() ?? ''
  value = value.split(':')[0] ?? ''
  // A fully-qualified name's trailing dot.
  value = value.replace(/\.+$/, '')

  if (!value || value.length > 253) return null
  if (value.startsWith('www.')) value = value.slice(4)

  const labels = value.split('.')
  if (labels.length < 2) return null
  if (!labels.every((label) => LABEL.test(label))) return null
  // A bare IP address is not a company website, and it is a favourite SSRF probe.
  if (/^[0-9.]+$/.test(value)) return null

  return value
}

/**
 * The reason this input is not usable, or null if it is fine.
 *
 * Returns a sentence for a person, not a code — it is rendered under the field
 * on the signup form and on the verification page, and both want the same words.
 */
export function domainProblem(input: string): string | null {
  const raw = (input ?? '').trim()
  if (!raw) return 'Enter your company website'

  const domain = normalizeDomain(raw)
  if (!domain) {
    return 'Enter a valid website address, for example acme.com'
  }
  if (MAILBOX_PROVIDERS.has(domain)) {
    return 'Enter your company’s own website, not an email provider'
  }
  if (RESERVED_SUFFIXES.some((suffix) => domain.endsWith(suffix))) {
    return 'That address is not reachable on the public internet'
  }
  return null
}

/**
 * Every parent of a host, down to (but not including) the bare TLD.
 *
 * `careers.acme.co.uk` → `['acme.co.uk', 'co.uk']`.
 *
 * The list is intentionally not filtered against a public-suffix list. `co.uk`
 * being in there is harmless: it is only ever used to look for an ALREADY
 * VERIFIED tenant, and nobody can verify `co.uk` — they would have to publish
 * our token on its homepage.
 */
export function parentDomains(domain: string): string[] {
  const labels = domain.split('.')
  const out: string[] = []
  for (let i = 1; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'))
  return out
}

/**
 * Are these two hosts the same organization for our purposes?
 *
 * True when they are equal, or when one is a subdomain of the other. Without
 * this, `acme.com` and `careers.acme.com` are two different rows that can both
 * be verified — one company, two workspaces, which is the exact outcome this
 * whole feature exists to prevent. The unique index alone cannot see it, because
 * to Postgres they are simply two different strings.
 */
export function domainsConflict(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/**
 * Whole days between now and the verification deadline; negative once passed,
 * null when there is no deadline recorded.
 *
 * Rounded UP so a deadline twelve hours away reads "1 day left" rather than
 * "0 days left", which looks like a bug on a banner that is still only asking.
 *
 * Lives here, and is called on the SERVER, so the banner can stay a pure
 * presentational client component. Computing `Date.now()` inside the component
 * would put a value in the markup that the browser can re-derive differently
 * moments later — a hydration mismatch on every page in the org portal.
 */
export function daysUntilDeadline(dueAt: string | null | undefined, now = Date.now()): number | null {
  if (!dueAt) return null
  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return null
  return Math.ceil((due - now) / 86_400_000)
}

/** "3 days left" / "due today" / "overdue by 2 days". */
export function deadlineLabel(days: number): string {
  if (days < 0) {
    const over = Math.abs(days)
    return over === 1 ? 'overdue by 1 day' : `overdue by ${over} days`
  }
  if (days === 0) return 'due today'
  if (days === 1) return '1 day left'
  return `${days} days left`
}

/** The tag to paste into `<head>`. */
export function metaTagFor(token: string): string {
  return `<meta name="${DOMAIN_META_NAME}" content="${token}" />`
}

/** The TXT record value, for the DNS route. */
export function txtRecordFor(token: string): string {
  return `${DOMAIN_TXT_PREFIX}${token}`
}

/**
 * The prompt an org can hand to their own coding assistant.
 *
 * Written as an instruction to an agent working in a repository, because that is
 * what most of them are: it names the file to look for, the exact string, where
 * it goes, and what NOT to do (invent a value, put it on a subpage).
 */
export function aiPromptFor(domain: string, token: string): string {
  return [
    `Add a domain-verification meta tag to my website so I can prove I own ${domain}.`,
    '',
    'Insert this exact tag inside the <head> element of the site\'s HOMEPAGE:',
    '',
    metaTagFor(token),
    '',
    'Requirements:',
    `- Copy the content value exactly as written above. Do not generate, shorten or change it.`,
    `- It must be served on the homepage at https://${domain}/ — not on a subpage,`,
    '  and not behind a login, a cookie banner or client-side JavaScript rendering.',
    '- If this is a Next.js app, add it to the root layout metadata or <head>.',
    '  If it is plain HTML, add it to index.html. If it is WordPress/Wix/Webflow/',
    '  Squarespace/Framer, add it in the site settings field for custom head code.',
    '- Leave the rest of the page untouched, then deploy the change to production.',
  ].join('\n')
}

/**
 * Attribute-aware scan for the verification tag in a page's HTML.
 *
 * A plain `html.includes(token)` would pass on a page that merely mentions the
 * token — a public paste, a forum post, a docs page quoting someone else's tag —
 * so the tag is parsed properly: it counts only as `<meta>` whose `name` is ours
 * and whose `content` is exactly the token.
 *
 * Tolerant about the things real HTML varies on (attribute order, quoting style,
 * casing, self-closing) and strict about the two values that matter.
 */
export function htmlHasVerificationTag(html: string, token: string): boolean {
  if (!html || !token) return false

  const metaTag = /<meta\b([^>]*)>/gi
  let match: RegExpExecArray | null

  while ((match = metaTag.exec(html)) !== null) {
    const attrs = parseAttributes(match[1] ?? '')
    if (attrs.name?.toLowerCase() !== DOMAIN_META_NAME) continue
    if (attrs.content?.trim() === token) return true
  }
  return false
}

/** Does any of these TXT record values carry our token? */
export function txtHasVerificationToken(records: string[], token: string): boolean {
  if (!token) return false
  const expected = txtRecordFor(token)
  return records.some((record) => record.trim() === expected)
}

function parseAttributes(source: string): Record<string, string> {
  const attribute = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/g
  const out: Record<string, string> = {}
  let match: RegExpExecArray | null
  while ((match = attribute.exec(source)) !== null) {
    const key = match[1].toLowerCase()
    if (!(key in out)) out[key] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return out
}
