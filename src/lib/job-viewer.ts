/**
 * Who is looking at the job portal, and what they may do there (052).
 *
 * Directive-free: the server resolves it (src/lib/job-viewer-server.ts) and
 * the client board reads it to decide what "Apply now" does.
 *
 *   anonymous   signed out — "Apply now" asks them to sign in or sign up
 *   applicant   a job seeker or an employee — may apply
 *   staff       an organization or platform admin — reads applications,
 *               does not send them
 */

export interface ApplicantPrefill {
  fullName: string
  email: string
  phone: string
  location: string
  linkedinUrl: string
  portfolioUrl: string
  currentCompany: string
  yearsExperience: string
  noticePeriod: string
}

export type JobViewer =
  | { kind: 'anonymous' }
  | { kind: 'staff'; home: string }
  | {
      kind: 'applicant'
      role: 'candidate' | 'employee'
      home: string
      /** Where this person follows their applications. */
      applicationsPath: string
      prefill: ApplicantPrefill
      /** The CV saved on a job seeker's profile, if they have one. */
      savedResumeName: string | null
      /** Jobs this person has already applied to. */
      appliedJobIds: string[]
    }

/** The sign-in page that returns to `path` afterwards. */
export function signInHref(path: string): string {
  return `/jobs/login?next=${encodeURIComponent(path)}`
}

export function signUpHref(path: string): string {
  return `/jobs/signup?next=${encodeURIComponent(path)}`
}

/** 🇺🇸 from "US" — regional-indicator letters, no image or dependency. */
export function countryFlag(code: string | null | undefined): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return '🌐'
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  )
}
