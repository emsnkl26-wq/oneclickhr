import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk } from '@/lib/api'
import { apiRequireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { candidateMatchSchema } from '@/lib/schemas'
import { parseRequirement, scoreCandidate, type CandidateText } from '@/lib/candidate-match'
import { skillList } from '@/lib/talent'

export const dynamic = 'force-dynamic'

/** Beyond this the ranking is noise — nobody reads the 51st best match. */
const RESULTS = 50

/**
 * How many people are loaded to rank. The whole pool is scored in memory, which
 * is fine at this size and is the honest limit of the approach: past a few
 * thousand job seekers this becomes a job for the database, with the terms
 * pushed into a `tsquery` and the scoring done there. The number is here, named,
 * so that day is a change to one constant and a query rather than an
 * archaeology exercise.
 */
const POOL = 2000

/** A match on its way out. Flattened for the table that renders it. */
interface MatchResult {
  key: string
  fullName: string | null
  email: string | null
  phone: string | null
  location: string | null
  headline: string | null
  currentCompany: string | null
  noticePeriod: string | null
  workAuthorization: string | null
  linkedinUrl: string | null
  skills: string[]
  hasResume: boolean
  /** Where we know them from — both, when the same address is in each pool. */
  origin: 'seeker' | 'applicant' | 'both'
  /** Their job-seeker profile, for the talent page. Null for a bare applicant. */
  profileId: string | null
  /** Our own postings they have applied to, newest first. */
  applications: Array<{ id: string; jobId: string; jobTitle: string; status: string; appliedAt: string }>
  score: number
  matched: string[]
  years: { candidate: number | null; required: number | null; short: boolean }
}

/**
 * Rank people against a role (061).
 *
 * THE POOL IS OURS AND ONLY OURS. Two sources, and the line between them and
 * everything else is the point:
 *
 *   • JOB SEEKERS who signed up on the portal. They came here to be found.
 *   • Everyone who has applied to a ONECLICKHR posting — `tenant_id is null`,
 *     the same test /super/jobs/[id] uses to decide whether it may show an
 *     applicant list at all.
 *
 * A customer's applicants are NOT in here, and that filter is the whole privacy
 * boundary of this feature. The service role can read them, and `/super/jobs/
 * [id]` has a paragraph explaining why it refuses to: platform oversight covers
 * account state and moderation, not reading the CVs of people who replied to
 * somebody else's advert. A ranking screen that quietly pooled them would undo
 * that decision without anyone having made it, so the filter is applied in the
 * query rather than after it.
 *
 * ONE PERSON, ONE ROW. Somebody who signed up as a job seeker AND applied to
 * one of our postings is one human being; they are merged on their email
 * address and scored on everything we know about them, rather than appearing
 * twice at two different scores.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireSuperAdmin()
  if (!gate.ok) return gate.response

  const input = await parseBody(request, candidateMatchSchema)
  const sources = new Set(input.sources ?? ['seekers', 'applicants'])

  const requirement = parseRequirement({
    title: input.title,
    description: input.description,
    minYears: input.minYears ?? null,
  })

  const admin = createAdminClient()

  const [seekers, applicants] = await Promise.all([
    sources.has('seekers')
      ? admin
          .from('profiles')
          .select(
            'id, full_name, email, created_at, candidate:candidate_profiles(headline, phone, location, country, work_authorization, years_experience, current_company, notice_period, linkedin_url, summary, skills, resume_key)'
          )
          .eq('role', 'candidate')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(POOL)
      : Promise.resolve({ data: [] }),

    sources.has('applicants')
      ? admin
          .from('job_applications')
          .select(
            'id, job_id, full_name, email, phone, location, linkedin_url, cover_letter, resume_key, years_experience, current_company, notice_period, status, applicant_profile_id, created_at, job:jobs!inner(id, title, tenant_id)'
          )
          // OUR postings only. See the header.
          .is('tenant_id', null)
          .order('created_at', { ascending: false })
          .limit(POOL)
      : Promise.resolve({ data: [] }),
  ])

  /** Merged by address — the one thing both pools reliably share. */
  const people = new Map<string, { text: CandidateText; result: MatchResult }>()

  /** An address, or a stable fallback so a row without one is still rankable. */
  const keyFor = (email: string | null | undefined, fallback: string) =>
    email ? `email:${email.trim().toLowerCase()}` : `row:${fallback}`

  for (const row of (seekers.data ?? []) as Array<Record<string, unknown>>) {
    // The embed is 1:1, but PostgREST may hand it back as an array.
    const raw = row.candidate
    const profile = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null
    const key = keyFor(row.email as string | null, String(row.id))

    const skills = skillList(profile?.skills)
    const years =
      profile?.years_experience === null || profile?.years_experience === undefined
        ? null
        : Number(profile.years_experience)

    people.set(key, {
      text: {
        skills,
        headline: [profile?.headline, profile?.current_company].filter(Boolean).map(String),
        prose: [profile?.summary, profile?.location, profile?.work_authorization]
          .filter(Boolean)
          .map(String),
        years: Number.isFinite(years) ? years : null,
      },
      result: {
        key,
        fullName: (row.full_name as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        phone: (profile?.phone as string | null) ?? null,
        location: (profile?.location as string | null) ?? null,
        headline: (profile?.headline as string | null) ?? null,
        currentCompany: (profile?.current_company as string | null) ?? null,
        noticePeriod: (profile?.notice_period as string | null) ?? null,
        workAuthorization: (profile?.work_authorization as string | null) ?? null,
        linkedinUrl: (profile?.linkedin_url as string | null) ?? null,
        skills,
        hasResume: !!profile?.resume_key,
        origin: 'seeker',
        profileId: row.id as string,
        applications: [],
        score: 0,
        matched: [],
        years: { candidate: null, required: null, short: false },
      },
    })
  }

  for (const row of (applicants.data ?? []) as Array<Record<string, unknown>>) {
    const jobRaw = row.job
    const job = (Array.isArray(jobRaw) ? jobRaw[0] : jobRaw) as Record<string, unknown> | null
    const key = keyFor(row.email as string | null, String(row.id))
    const years =
      row.years_experience === null || row.years_experience === undefined
        ? null
        : Number(row.years_experience)

    const application = {
      id: String(row.id),
      jobId: String(row.job_id),
      jobTitle: (job?.title as string) ?? 'A OneclickHR role',
      status: (row.status as string) ?? 'new',
      appliedAt: String(row.created_at),
    }

    const existing = people.get(key)
    if (existing) {
      /*
       * Already here as a job seeker. Their application ADDS to what we know
       * rather than replacing it: the cover letter they wrote for one of our
       * roles is often the most on-point prose they have given us, and their
       * profile is where the declared skills live. Dropping either would make
       * the person who engaged with us most score lowest.
       */
      if (row.cover_letter) existing.text.prose.push(String(row.cover_letter))
      if (row.current_company) existing.text.headline.push(String(row.current_company))
      if (existing.text.years === null && Number.isFinite(years)) existing.text.years = years
      existing.result.origin = 'both'
      existing.result.applications.push(application)
      existing.result.phone ??= (row.phone as string | null) ?? null
      existing.result.location ??= (row.location as string | null) ?? null
      existing.result.hasResume ||= !!row.resume_key
      continue
    }

    people.set(key, {
      text: {
        // An application carries no declared skill list — the résumé has them
        // and we do not parse files. The cover letter is prose, and is scored
        // as prose, which is why an applicant rarely out-ranks a job seeker who
        // has filled in a profile. That is the correct order to call them in.
        skills: [],
        headline: [row.current_company].filter(Boolean).map(String),
        prose: [row.cover_letter, row.location].filter(Boolean).map(String),
        years: Number.isFinite(years) ? years : null,
      },
      result: {
        key,
        fullName: (row.full_name as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        location: (row.location as string | null) ?? null,
        headline: null,
        currentCompany: (row.current_company as string | null) ?? null,
        noticePeriod: (row.notice_period as string | null) ?? null,
        workAuthorization: null,
        linkedinUrl: (row.linkedin_url as string | null) ?? null,
        skills: [],
        hasResume: !!row.resume_key,
        origin: 'applicant',
        profileId: (row.applicant_profile_id as string | null) ?? null,
        applications: [application],
        score: 0,
        matched: [],
        years: { candidate: null, required: null, short: false },
      },
    })
  }

  const ranked: MatchResult[] = []
  for (const { text, result } of people.values()) {
    const score = scoreCandidate(requirement, text)
    // A zero is not a weak match, it is "nothing in common with this role".
    // Printing those would bury the real answers under the whole directory.
    if (score.score <= 0) continue
    ranked.push({ ...result, ...score })
  }

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      // A tie between somebody who applied to this kind of role and somebody who
      // did not goes to the one who already raised their hand.
      b.applications.length - a.applications.length ||
      (a.fullName ?? '').localeCompare(b.fullName ?? '')
  )

  return jsonOk({
    results: ranked.slice(0, RESULTS),
    /** What the ranking was actually run on — the UI shows it, so it is checkable. */
    terms: [...requirement.terms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([term]) => term),
    minYears: requirement.minYears,
    searched: people.size,
    matched: ranked.length,
  })
}

export const POST = withErrorHandler(handlePOST)
