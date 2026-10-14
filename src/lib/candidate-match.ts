/**
 * Matching people against a role.
 *
 * WHY THIS EXISTS. The job portal is the one part of the product that earns
 * anything — everything else is given away — and what it earns depends on us
 * finding the right person for a requirement quickly. Until now the platform
 * console could list applicants and list job seekers, which answers "who is
 * there?" and not "who should I call first?". This answers the second one.
 *
 * IT IS DELIBERATELY NOT CLEVER. No embeddings, no model, no service. Three
 * reasons, in order of how much they mattered:
 *
 *   1. Every result has to be EXPLAINABLE. A recruiter ranking strangers needs
 *      to see which words matched before they trust an order, and "the vector
 *      was close" is not a reason anyone can act on. Every score this returns
 *      carries the exact terms that produced it, and the UI prints them.
 *   2. It must never be wrong in a way nobody notices. A scorer built from a
 *      visible rule can be read, argued with and corrected; a learned one hides
 *      its mistakes behind plausible output.
 *   3. It runs in-process over a few thousand rows in a few milliseconds, with
 *      nothing to pay for, nothing to key, and nothing to keep in sync.
 *
 * HOW IT SCORES, in one paragraph. The requirement is reduced to a set of
 * weighted terms: words from the ROLE TITLE count for more than words from the
 * body, and a word the description keeps repeating counts for more than one it
 * mentions once. Each person is reduced to three bands of text — their skills,
 * their current role, and their free prose — which are worth 3, 2 and 1. A hit
 * scores (term weight x band weight), the best band wins for any given term, and
 * the total is reported as a percentage of what a perfect candidate would score.
 * Years of experience is applied on top as a multiplier rather than a filter,
 * because "two years short" is a conversation and a hard cut-off is not.
 *
 * PURE, and free of `server-only`: the API handler scores, and the tests score
 * the same way. Nothing here touches the network or the database.
 */

/** Words that carry no signal in a job description. Kept short on purpose — an
 *  over-long stop list quietly deletes real requirements ("go", "r", "c"). */
const STOPWORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'been', 'being', 'both', 'but', 'by', 'can', 'could', 'do', 'does', 'each', 'etc', 'for',
  'from', 'had', 'has', 'have', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'may', 'might',
  'more', 'most', 'must', 'no', 'not', 'of', 'on', 'one', 'only', 'or', 'other', 'our', 'out',
  'over', 'own', 'per', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'up', 'us', 'use', 'using',
  'very', 'was', 'we', 'well', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why',
  'will', 'with', 'within', 'would', 'you', 'your',
  // Recruitment boilerplate. Present in every description, so present in every
  // candidate's prose too — they rank nobody above anybody.
  'ability', 'candidate', 'candidates', 'description', 'experience', 'excellent', 'good', 'great',
  'job', 'knowledge', 'looking', 'opportunity', 'required', 'requirements', 'responsibilities',
  'role', 'skills', 'strong', 'team', 'work', 'working', 'years', 'plus', 'preferred', 'ideal',
  'position', 'company', 'please', 'apply', 'benefits', 'salary', 'etc',
])

/**
 * Text → terms.
 *
 * `c++`, `c#`, `.net` and `node.js` are the reason this is not `\w+`: stripping
 * punctuation turns four distinct, highly specific requirements into `c`, `c`,
 * `net` and `node js`, and `c` is then a stopword. The characters that carry
 * meaning inside a technology's name are kept, and only the ones that never do
 * are treated as separators.
 */
export function tokenize(text: string): string[] {
  return (text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9+#._-]+/)
    .map((token) => token.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((token) => token.length >= 2 && token.length <= 40 && !STOPWORDS.has(token))
    // A bare number is a salary, a year or a list marker, never a requirement.
    .filter((token) => !/^[0-9]+$/.test(token))
}

/** What we are hiring for, reduced to weighted terms. */
export interface Requirement {
  /** term → weight. Higher means "this is more of what the role is". */
  terms: Map<string, number>
  /** The sum of every weight — what a candidate who matched everything scores. */
  totalWeight: number
  /** Years of experience asked for, if the request named a number. */
  minYears: number | null
}

/**
 * Build a requirement from whatever the recruiter typed.
 *
 * `title` is weighted at THREE TIMES the body, and that single decision is most
 * of what makes the ranking feel right. A description for a "Senior Salesforce
 * Developer" mentions Salesforce once and the word "collaborate" four times; by
 * raw frequency the role is about collaborating. The title is the part a human
 * would read first, so it is the part that decides.
 *
 * Repetition inside the body counts, with diminishing returns (1 + log). A term
 * the description returns to five times matters more than one it lists once —
 * but not five times more, or a single stylistic tic would own the ranking.
 */
export function parseRequirement(input: {
  title?: string | null
  description?: string | null
  minYears?: number | null
}): Requirement {
  const terms = new Map<string, number>()

  for (const token of tokenize(input.title ?? '')) {
    terms.set(token, (terms.get(token) ?? 0) + 3)
  }

  const bodyCounts = new Map<string, number>()
  for (const token of tokenize(input.description ?? '')) {
    bodyCounts.set(token, (bodyCounts.get(token) ?? 0) + 1)
  }
  for (const [token, count] of bodyCounts) {
    terms.set(token, (terms.get(token) ?? 0) + 1 + Math.log(count))
  }

  /*
   * Keep the strongest 60.
   *
   * A long description has a tail of hundreds of near-worthless terms, and
   * because the score is a fraction of the TOTAL weight, that tail does not
   * just add noise — it drags every real match's percentage towards zero. The
   * cut is on the requirement, so the denominator shrinks with it.
   */
  const kept = [...terms.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)
  const trimmed = new Map(kept)

  return {
    terms: trimmed,
    totalWeight: kept.reduce((sum, [, weight]) => sum + weight, 0),
    minYears: input.minYears ?? extractYears(input.description ?? ''),
  }
}

/**
 * "5+ years", "3-5 years", "minimum 4 years" → the lower bound.
 *
 * Only read when the caller did not state one. Takes the SMALLEST number it
 * finds rather than the first: descriptions routinely say "3+ years overall,
 * 5 years in a lead role", and the lower figure is the one that gates applying.
 */
function extractYears(text: string): number | null {
  const matches = [...(text ?? '').matchAll(/(\d{1,2})\s*(?:\+|-|\s+to\s+\d{1,2})?\s*(?:\+\s*)?years?/gi)]
  const years = matches
    .map((match) => Number.parseInt(match[1] ?? '', 10))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 40)
  return years.length ? Math.min(...years) : null
}

/**
 * One person, in the three bands the scorer understands.
 *
 * Splitting the text this way is what stops a cover letter out-ranking a skill
 * list. Somebody who writes "I would love to learn Salesforce one day" and
 * somebody who has Salesforce in their skills both contain the word; they are
 * not the same candidate, and the band is how the scorer knows.
 */
export interface CandidateText {
  /** Declared skills — the strongest claim a person makes. Band weight 3. */
  skills: string[]
  /** Headline, designation, current role, latest job title. Band weight 2. */
  headline: string[]
  /** Summary, cover letter, employer, location. Band weight 1. */
  prose: string[]
  /** Years of experience, when known. */
  years: number | null
}

const BAND_WEIGHT = { skills: 3, headline: 2, prose: 1 } as const

export interface MatchScore {
  /** 0–100. A share of the requirement's total weight, not a probability. */
  score: number
  /** The terms that actually matched, strongest first — the "why". */
  matched: string[]
  /** How the years lined up, for the UI to show plainly. */
  years: { candidate: number | null; required: number | null; short: boolean }
}

/**
 * Score one person against one requirement.
 *
 * A term scores ONCE, in the best band it appears in. Without that, a candidate
 * who lists "react" as a skill, in their headline and three times in their
 * summary would beat a candidate who has it as a skill and got on with the job
 * — the scorer would be rewarding how much somebody wrote about themselves.
 */
export function scoreCandidate(requirement: Requirement, candidate: CandidateText): MatchScore {
  if (!requirement.totalWeight) {
    return { score: 0, matched: [], years: { candidate: candidate.years, required: null, short: false } }
  }

  const bands: Array<[keyof typeof BAND_WEIGHT, Set<string>]> = [
    ['skills', new Set(candidate.skills.flatMap(tokenize))],
    ['headline', new Set(candidate.headline.flatMap(tokenize))],
    ['prose', new Set(candidate.prose.flatMap(tokenize))],
  ]

  let earned = 0
  const hits: Array<{ term: string; weight: number }> = []

  for (const [term, termWeight] of requirement.terms) {
    let best = 0
    for (const [band, tokens] of bands) {
      if (tokens.has(term)) best = Math.max(best, BAND_WEIGHT[band])
    }
    if (!best) continue
    const value = termWeight * best
    earned += value
    hits.push({ term, weight: value })
  }

  // The denominator assumes every term matched in the SKILLS band, so 100 means
  // "every requirement is a declared skill" — reachable, and rare, which is what
  // makes the number mean something.
  const raw = earned / (requirement.totalWeight * BAND_WEIGHT.skills)

  const required = requirement.minYears
  const short = required !== null && candidate.years !== null && candidate.years < required

  /*
   * Experience is a MULTIPLIER, never a filter.
   *
   * Dropping everyone below the stated figure throws away the person who is one
   * year short and perfect on everything else — who is, in practice, somebody we
   * would want to call. Being short pushes them down the list instead of off it,
   * in proportion to how short they are, and the UI says why.
   */
  let factor = 1
  if (short) {
    factor = 0.55 + 0.45 * ((candidate.years as number) / (required as number))
  } else if (required !== null && candidate.years === null) {
    // Unknown experience against a role that named a figure: a small nudge down,
    // because an unanswered question is not the same as a satisfied one.
    factor = 0.9
  }

  return {
    score: Math.round(Math.min(100, raw * 100 * factor)),
    matched: hits.sort((a, b) => b.weight - a.weight).map((hit) => hit.term).slice(0, 12),
    years: { candidate: candidate.years, required, short },
  }
}
