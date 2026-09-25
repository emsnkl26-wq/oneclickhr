import { describe, it, expect } from 'vitest'
import { ownsResumeKey, resumeKey, isResumeKey, toPublicJob } from '@/lib/jobs'
import { countryFlag, signInHref } from '@/lib/job-viewer'
import { EXPERIENCE_BANDS, JOB_TYPE_LABELS, APPLICATION_STATUS_LABELS } from '@/lib/job-form'
import {
  JOB_TYPES, candidateProfileSchema, candidateSignupSchema, deleteTenantSchema, deleteUserSchema,
  jobApplicationSchema, jobSchema, loginSchema, resumePresignSchema,
} from '@/lib/schemas'
import { navFor } from '@/components/shell/nav-config'
import { isPublicPath } from '@/lib/auth/public-paths'
import type { Job } from '@/types/db'

const USER = '0b6c1f4e-3a2d-4c5b-9e8f-7a6b5c4d3e2f'
const OTHER = '9f8e7d6c-5b4a-4321-8fed-cba987654321'

describe('résumé keys are namespaced by uploader (052)', () => {
  it('mints keys under the owner', () => {
    const key = resumeKey('pdf', USER)
    expect(key.startsWith(`applications/resumes/${USER}/`)).toBe(true)
    expect(key.endsWith('.pdf')).toBe(true)
    expect(isResumeKey(key)).toBe(true)
  })

  it('only its uploader owns a key', () => {
    const key = resumeKey('docx', USER)
    expect(ownsResumeKey(key, USER)).toBe(true)
    expect(ownsResumeKey(key, OTHER)).toBe(false)
  })

  it('refuses legacy, traversal and foreign keys', () => {
    expect(ownsResumeKey('applications/resumes/abc.pdf', USER)).toBe(false)
    expect(ownsResumeKey(`applications/resumes/${USER}/../${OTHER}/x.pdf`, USER)).toBe(false)
    expect(ownsResumeKey(`${USER}/documents/x.pdf`, USER)).toBe(false)
    expect(ownsResumeKey(null, USER)).toBe(false)
  })
})

describe('the candidate role (052)', () => {
  it('has its own portal nav, with no workspace screens', () => {
    const hrefs = navFor('candidate').flatMap((s) => s.items.map((i) => i.href))
    expect(hrefs).toEqual(expect.arrayContaining(['/candidate', '/candidate/profile', '/jobs']))
    expect(hrefs.some((h) => h.startsWith('/org') || h.startsWith('/employee'))).toBe(false)
  })

  it('signs in through its own door', () => {
    expect(loginSchema.parse({ email: 'a@b.co', password: 'x', portal: 'candidate' }).portal).toBe(
      'candidate'
    )
    // Omitting the door still means the strictest one.
    expect(loginSchema.parse({ email: 'a@b.co', password: 'x' }).portal).toBe('org')
  })

  it('can sign up without any workspace fields, with the usual password rules', () => {
    expect(
      candidateSignupSchema.safeParse({ fullName: 'Ravi K', email: 'ravi@example.com', password: 'longenough1' })
        .success
    ).toBe(true)
    expect(
      candidateSignupSchema.safeParse({ fullName: 'Ravi K', email: 'ravi@example.com', password: 'short1' })
        .success
    ).toBe(false)
  })

  it('reaches its sign-up endpoint and pages without a session', () => {
    expect(isPublicPath('/api/auth/candidate-signup')).toBe(true)
    expect(isPublicPath('/jobs/login')).toBe(true)
    expect(isPublicPath('/jobs/signup')).toBe(true)
    expect(isPublicPath('/candidate')).toBe(false)
  })
})

describe('applications', () => {
  it('no longer needs an email in the body — the account supplies it', () => {
    const parsed = jobApplicationSchema.parse({ jobId: USER, fullName: 'Ravi K' })
    expect(parsed.email).toBeUndefined()
    expect(parsed.useSavedResume).toBe(false)
  })

  it('a CV upload may omit the job (the profile CV)', () => {
    expect(
      resumePresignSchema.safeParse({ fileName: 'cv.pdf', contentType: 'application/pdf', sizeBytes: 1000 })
        .success
    ).toBe(true)
  })

  it('shows applicants softer stage names', () => {
    expect(APPLICATION_STATUS_LABELS.rejected).toBe('Not selected')
    expect(APPLICATION_STATUS_LABELS.new).toBe('Received')
  })
})

describe('job postings (052)', () => {
  const base = {
    title: 'DevOps engineer',
    description: 'Run the platform and keep it healthy, day and night.',
  }

  it('offers the staffing engagement types, all labelled', () => {
    expect(JOB_TYPES).toEqual(expect.arrayContaining(['c2c', 'w2', 'contract_to_hire']))
    for (const type of JOB_TYPES) expect(JOB_TYPE_LABELS[type]).toBeTruthy()
  })

  it('accepts recruiter contact, https links only', () => {
    const ok = jobSchema.safeParse({
      ...base,
      recruiterName: 'Vinod Kumar',
      recruiterEmail: 'careers@example.com',
      recruiterLinkedinUrl: 'https://www.linkedin.com/in/vinod',
    })
    expect(ok.success).toBe(true)
    expect(jobSchema.safeParse({ ...base, recruiterLinkedinUrl: 'javascript:alert(1)' }).success).toBe(false)
    expect(jobSchema.safeParse({ ...base, recruiterLinkedinUrl: 'http://example.com' }).success).toBe(false)
    expect(jobSchema.safeParse({ ...base, recruiterEmail: 'not-an-email' }).success).toBe(false)
  })

  it('treats blank recruiter fields as none', () => {
    const parsed = jobSchema.parse({ ...base, recruiterEmail: '', recruiterLinkedinUrl: '' })
    expect(parsed.recruiterEmail).toBeNull()
    expect(parsed.recruiterLinkedinUrl).toBeNull()
  })

  it('publishes the recruiter block only when there is one, and never a non-https link', () => {
    const row = {
      id: USER,
      tenant_id: null,
      title: 'x',
      description: 'y',
      responsibilities: null,
      requirements: null,
      employment_type: 'c2c',
      workplace: 'remote',
      location: null,
      country: 'US',
      experience_min: null,
      experience_max: null,
      salary_min: null,
      salary_max: null,
      salary_currency: 'USD',
      salary_period: 'year',
      salary_disclosed: false,
      openings: 1,
      skills: [],
      published_at: null,
      closes_at: null,
    } as unknown as Job
    const company = { id: null, name: 'Oneclickhr', slug: null, isPlatform: true, logoUrl: null, website: null, location: null }

    expect(toPublicJob(row, company).recruiter).toBeNull()
    const withRecruiter = toPublicJob(
      { ...row, recruiter_name: 'Vinod', recruiter_linkedin_url: 'javascript:alert(1)' } as Job,
      company
    )
    expect(withRecruiter.recruiter?.name).toBe('Vinod')
    expect(withRecruiter.recruiter?.linkedinUrl).toBeNull()
    expect(withRecruiter.country).toBe('US')
  })

  it('has the three experience bands the portal filters by', () => {
    expect(Object.keys(EXPERIENCE_BANDS)).toEqual(['0-3', '4-7', '8+'])
  })
})

describe('portal helpers', () => {
  it('draws a flag from a country code', () => {
    expect(countryFlag('US')).toBe('🇺🇸')
    expect(countryFlag('in')).toBe('🇮🇳')
    expect(countryFlag(null)).toBe('🌐')
    expect(countryFlag('USA')).toBe('🌐')
  })

  it('sends people back to where they were after signing in', () => {
    expect(signInHref('/jobs/abc?apply=1')).toBe('/jobs/login?next=%2Fjobs%2Fabc%3Fapply%3D1')
  })

  it('validates a candidate profile', () => {
    expect(
      candidateProfileSchema.safeParse({ fullName: 'Ravi K', linkedinUrl: 'javascript:alert(1)' }).success
    ).toBe(false)
    const parsed = candidateProfileSchema.parse({ fullName: 'Ravi K', country: '', yearsExperience: '' })
    expect(parsed.country).toBeNull()
    expect(parsed.yearsExperience).toBeNull()
  })
})

describe('platform deletions need explicit intent (053)', () => {
  it('an organization needs the typed phrase, a password and a reason', () => {
    const ok = { confirmName: 'Acme', confirmPhrase: 'DELETE', password: 'x', reason: 'Closed account' }
    expect(deleteTenantSchema.safeParse(ok).success).toBe(true)
    expect(deleteTenantSchema.safeParse({ ...ok, confirmPhrase: 'delete' }).success).toBe(false)
    expect(deleteTenantSchema.safeParse({ ...ok, password: '' }).success).toBe(false)
    expect(deleteTenantSchema.safeParse({ ...ok, reason: 'no' }).success).toBe(false)
  })

  it('a person needs their email, a password and a reason', () => {
    const ok = { confirmEmail: 'a@b.co', password: 'x', reason: 'Asked to be removed' }
    expect(deleteUserSchema.safeParse(ok).success).toBe(true)
    expect(deleteUserSchema.safeParse({ ...ok, confirmEmail: 'nope' }).success).toBe(false)
  })
})
