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
import type { JobType, JobWorkplace, SalaryPeriod } from '@/types/db'

export interface JobFormValues {
  id?: string
  title: string
  description: string
  responsibilities: string
  requirements: string
  departmentId: string
  employmentType: JobType
  workplace: JobWorkplace
  location: string
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
}

export const EMPTY_JOB_FORM: JobFormValues = {
  title: '',
  description: '',
  responsibilities: '',
  requirements: '',
  departmentId: '',
  employmentType: 'full_time',
  workplace: 'onsite',
  location: '',
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
  location: string | null
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
    location: row.location ?? '',
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
  }
}
