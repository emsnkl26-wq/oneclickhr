/**
 * The job form's shape, and the mapping from a database row into it.
 *
 * DELIBERATELY FREE OF BOTH DIRECTIVES — no `'use client'`, no `server-only`.
 *
 * That is the whole reason this module exists rather than living next to the
 * dialog it describes. `toFormValues` is called by two Server Components
 * (/org/jobs and /super/jobs) to prepare the values a CLIENT dialog will edit.
 * When it lived in the dialog's own `'use client'` module, those imports came
 * back as client-reference proxies at runtime and threw the moment they were
 * called — a failure that type-checks and builds perfectly and only appears when
 * someone opens the page. `npm run check:boundaries` is what catches it.
 *
 * So: values and mappings here, where both sides may import them; components in
 * the `'use client'` file.
 */
import type { ApplicationStatus, JobType, JobWorkplace, SalaryPeriod } from '@/types/db'

export interface JobFormValues {
  id?: string
  title: string
  description: string
  responsibilities: string
  requirements: string
  departmentId: string
  employmentType: JobType
  workplace: JobWorkplace
  country: string
  state: string
  city: string
  address: string
  /**
   * Numbers are held as STRINGS throughout the form.
   *
   * An `<input type="number">` reports '' for an empty box, and a controlled
   * field typed as `number | null` has to invent a value for that — usually 0,
   * which then saves a salary of zero for a field nobody filled in. Keeping the
   * form's own state as text means "" stays "" all the way to the schema, where
   * `optionalNumber` maps it to null once.
   */
  experienceMin: string
  experienceMax: string
  salaryMin: string
  salaryMax: string
  salaryCurrency: string
  salaryPeriod: SalaryPeriod
  salaryDisclosed: boolean
  openings: string
  skills: string[]
  closesAt: string
  /** 052 — recruiter contact and engagement details, all optional text. */
  recruiterName: string
  recruiterTitle: string
  recruiterEmail: string
  recruiterPhone: string
  recruiterLinkedinUrl: string
  companyLinkedinUrl: string
  clientName: string
  duration: string
  startDateLabel: string
  workAuthorization: string
}

export const EMPTY_JOB_FORM: JobFormValues = {
  title: '',
  description: '',
  responsibilities: '',
  requirements: '',
  departmentId: '',
  employmentType: 'full_time',
  workplace: 'onsite',
  country: '',
  state: '',
  city: '',
  address: '',
  experienceMin: '',
  experienceMax: '',
  salaryMin: '',
  salaryMax: '',
  salaryCurrency: 'INR',
  salaryPeriod: 'year',
  salaryDisclosed: false,
  openings: '1',
  skills: [],
  closesAt: '',
  recruiterName: '',
  recruiterTitle: '',
  recruiterEmail: '',
  recruiterPhone: '',
  recruiterLinkedinUrl: '',
  companyLinkedinUrl: '',
  clientName: '',
  duration: '',
  startDateLabel: '',
  workAuthorization: '',
}

/** A `jobs` row, as the two consoles select it, turned into form values. */
export function toFormValues(row: {
  id: string
  title: string
  description: string
  responsibilities: string | null
  requirements: string | null
  department_id: string | null
  employment_type: JobType
  workplace: JobWorkplace
  country: string | null
  state: string | null
  city: string | null
  address: string | null
  experience_min: number | null
  experience_max: number | null
  salary_min: number | string | null
  salary_max: number | string | null
  salary_currency: string
  salary_period: SalaryPeriod
  salary_disclosed: boolean
  openings: number
  skills: unknown
  closes_at: string | null
  recruiter_name?: string | null
  recruiter_title?: string | null
  recruiter_email?: string | null
  recruiter_phone?: string | null
  recruiter_linkedin_url?: string | null
  company_linkedin_url?: string | null
  client_name?: string | null
  duration?: string | null
  start_date_label?: string | null
  work_authorization?: string | null
}): JobFormValues {
  const text = (value: number | string | null) => (value === null ? '' : String(value))
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    responsibilities: row.responsibilities ?? '',
    requirements: row.requirements ?? '',
    departmentId: row.department_id ?? '',
    employmentType: row.employment_type,
    workplace: row.workplace,
    country: row.country ?? '',
    state: row.state ?? '',
    city: row.city ?? '',
    address: row.address ?? '',
    experienceMin: text(row.experience_min),
    experienceMax: text(row.experience_max),
    salaryMin: text(row.salary_min),
    salaryMax: text(row.salary_max),
    salaryCurrency: row.salary_currency,
    salaryPeriod: row.salary_period,
    salaryDisclosed: row.salary_disclosed,
    openings: String(row.openings),
    skills: Array.isArray(row.skills) ? (row.skills as string[]) : [],
    closesAt: row.closes_at ?? '',
    recruiterName: row.recruiter_name ?? '',
    recruiterTitle: row.recruiter_title ?? '',
    recruiterEmail: row.recruiter_email ?? '',
    recruiterPhone: row.recruiter_phone ?? '',
    recruiterLinkedinUrl: row.recruiter_linkedin_url ?? '',
    companyLinkedinUrl: row.company_linkedin_url ?? '',
    clientName: row.client_name ?? '',
    duration: row.duration ?? '',
    startDateLabel: row.start_date_label ?? '',
    workAuthorization: row.work_authorization ?? '',
  }
}

/*
 * Display labels, in the directive-free module so client and server both read
 * the one copy. There used to be four, and adding a job type meant finding
 * them all.
 */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  contract_to_hire: 'Contract to hire',
  c2c: 'C2C (Corp-to-Corp)',
  w2: 'W2',
  internship: 'Internship',
  temporary: 'Temporary',
}

export const JOB_WORKPLACE_LABELS: Record<JobWorkplace, string> = {
  onsite: 'On site',
  remote: 'Remote',
  hybrid: 'Hybrid',
}

/**
 * The portal's experience filter, as bands of years. `max: null` is open-ended.
 *
 * A band matches a posting whose own range OVERLAPS it, not one that sits
 * inside it: a "2–6 years" role is a real option for someone with 5, and hiding
 * it from "4–7" because it starts at 2 would hide most jobs from most people. A
 * posting that states no experience at all is open to everyone, so it matches
 * every band.
 */
export const EXPERIENCE_BANDS = {
  '0-3': { label: '0–3 years', min: 0, max: 3 },
  '4-7': { label: '4–7 years', min: 4, max: 7 },
  '8+': { label: '8+ years', min: 8, max: null },
} as const satisfies Record<string, { label: string; min: number; max: number | null }>

export type ExperienceBand = keyof typeof EXPERIENCE_BANDS

/** "Posted within" windows for the portal feed, in hours. */
export const POSTED_WITHIN = {
  '24h': { label: 'Last 24 hours', hours: 24 },
  '3d': { label: 'Last 3 days', hours: 72 },
  '7d': { label: 'Last week', hours: 24 * 7 },
  '30d': { label: 'Last month', hours: 24 * 30 },
} as const

export type PostedWithin = keyof typeof POSTED_WITHIN

export const JOB_SORTS = { newest: 'Newest', oldest: 'Oldest' } as const
export type JobSort = keyof typeof JOB_SORTS

/**
 * An application's stage in the words the APPLICANT sees (052) — softer than
 * the hiring team's own labels; "Rejected" reads differently from the other
 * side of the table.
 */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  new: 'Received',
  reviewing: 'Under review',
  shortlisted: 'Shortlisted',
  interviewing: 'Interviewing',
  offered: 'Offer made',
  hired: 'Hired',
  rejected: 'Not selected',
}

/** "2–5 years", "5+ years", "Entry level" — or null when unspecified. */
export function experienceLabel(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null
  if (min !== null && max !== null) {
    if (min === max) return min === 0 ? 'Entry level' : `${min} years`
    return `${min}–${max} years`
  }
  if (min !== null) return min === 0 ? 'Entry level' : `${min}+ years`
  return `Up to ${max} years`
}
