/**
 * The portal's query string, parsed once (057).
 *
 * TWO callers read the same URL and must agree exactly: the server component at
 * /jobs, which renders the first paint, and `/api/jobs/feed`, which answers
 * every filter click after it. When those two disagree the page shows one list
 * and the next click shows a different one for the same URL — so the parsing
 * lives here, and neither of them is allowed its own copy.
 *
 * EVERY VALUE IS CHECKED AGAINST A CONSTANT, never passed through. These values
 * reach a service-role query (see the header of jobs-public.ts), where the
 * filters are the only thing standing between a caller and the whole table. An
 * unrecognised value is dropped, not escaped, not defaulted to something broad.
 */
import {
  EXPERIENCE_BANDS,
  JOB_SORTS,
  POSTED_WITHIN,
  type ExperienceBand,
  type JobSort,
  type PostedWithin,
} from '@/lib/job-form'
import { JOB_TYPES, JOB_WORKPLACES } from '@/lib/schemas'

/** The longest search term the portal will run. Longer is truncated, not refused. */
export const MAX_QUERY_LENGTH = 80

export interface ParsedJobFeedParams {
  q: string
  types: string[]
  workplaces: string[]
  experience: ExperienceBand[]
  posted: PostedWithin | undefined
  sort: JobSort
  page: number
  /** The raw `?country=` as given, upper-cased. Resolving it needs the country
   *  list and the visitor's geo header, so the page does that part. */
  requestedCountry: string
}

/** Anything that answers `get(name)` — a `URLSearchParams`, or a stand-in. */
interface ParamSource {
  get(name: string): string | null | undefined
}

/** A comma list from the URL, kept to the values `allowed` actually contains. */
function listParam<T extends string>(value: string | null | undefined, allowed: readonly T[]): T[] {
  if (!value) return []
  const set = new Set(allowed as readonly string[])
  return Array.from(new Set(value.split(',').map((v) => v.trim()))).filter((v): v is T => set.has(v))
}

export function parseJobFeedParams(source: ParamSource): ParsedJobFeedParams {
  const posted = source.get('posted') ?? ''
  const sort = source.get('sort') ?? ''

  return {
    q: (source.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH),
    types: listParam(source.get('type'), JOB_TYPES),
    workplaces: listParam(source.get('mode'), JOB_WORKPLACES),
    experience: listParam(source.get('exp'), Object.keys(EXPERIENCE_BANDS) as ExperienceBand[]),
    // Own-property checks, not `in`: a param of "toString" must not pass.
    posted: Object.hasOwn(POSTED_WITHIN, posted) ? (posted as PostedWithin) : undefined,
    sort: Object.hasOwn(JOB_SORTS, sort) ? (sort as JobSort) : 'newest',
    page: Math.max(1, parseInt(source.get('page') ?? '', 10) || 1),
    requestedCountry: (source.get('country') ?? '').trim().toUpperCase(),
  }
}

/**
 * The country the feed should actually use.
 *
 * `?country=XX` or `?country=all`. With neither, the visitor's own country
 * (Vercel's geo header) is used when there are postings there, and all countries
 * otherwise — landing somebody on an empty list is the worst default.
 */
export function resolveCountry(
  requested: string,
  visitorCountry: string,
  known: Set<string>
): string | null {
  if (requested === 'ALL') return null
  // A country with no postings is still honoured — the link said so, and the
  // switcher offers a way out — but it has to be a real two-letter code.
  if (/^[A-Z]{2}$/.test(requested)) return requested

  const visitor = visitorCountry.toUpperCase()
  return /^[A-Z]{2}$/.test(visitor) && known.has(visitor) ? visitor : null
}
