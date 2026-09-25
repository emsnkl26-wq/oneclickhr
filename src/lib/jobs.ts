import 'server-only'

/**
 * Job helpers shared by the org, super-admin and public handlers.
 *
 * They live here rather than being exported from a route file because Next.js
 * validates the exports of a Route Handler module — anything that is not an HTTP
 * method or a recognised segment option is a build error.
 *
 * The résumé rules below are the security-interesting part of this file: they
 * are the policy for the ONLY write in this product an anonymous caller can
 * perform. Read `resumeKey()` before changing any of them.
 */
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { headObject, getObjectHead, deleteObject } from '@/lib/r2'
import { sniffMime } from '@/lib/upload'
import { SNIFF_BYTES } from '@/lib/upload-policy'
import { sendApplicationStatusUpdate } from '@/lib/email'
import type { Job, PublicJob, SalaryPeriod } from '@/types/db'
import type { JobInput } from '@/lib/schemas'

// ---------------------------------------------------------------------------
// Résumé policy
// ---------------------------------------------------------------------------

/** 10MB. A CV that does not fit is a portfolio, and there is a field for that. */
export const MAX_RESUME_BYTES = 10 * 1024 * 1024

/**
 * The only extensions an applicant may upload.
 *
 * An allowlist rather than a denylist, because the caller is anonymous and a
 * denylist is a promise to have thought of everything. Images are absent
 * deliberately: a photographed CV is unreadable to every screening tool an org
 * might run, and accepting one lets an applicant believe they applied.
 */
export const RESUME_EXTENSIONS = new Set(['pdf', 'doc', 'docx'])

/**
 * What the bytes are allowed to actually BE, once sniffed.
 *
 * `.doc` and `.docx` share the OLE/ZIP container with a great deal else, so
 * these are the true fingerprints, not the claimed content types. A `.docx` is
 * a zip file — `application/zip` appears here because that is what `file-type`
 * reports for one whose internals it does not unpack, and refusing it would
 * reject a large share of genuine Word documents.
 */
const RESUME_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
  'application/x-cfb',
])

/**
 * Where an applicant's CV is stored — and the one line in this feature that has
 * to be got right.
 *
 * The prefix is the literal string `applications/`, NOT a tenant id, and that is
 * load-bearing. `keyBelongsToTenant()` in r2.ts answers "does this key start with
 * the caller's tenant uuid?", and `/api/files/view` refuses everything for which
 * it says no. Because `applications` is not and cannot be a uuid, that check
 * fails for every tenant that will ever exist, and the general-purpose download
 * route is therefore structurally incapable of serving a résumé — to an org, to
 * an employee, to a super admin, to anyone.
 *
 * Résumés are read through `/api/org/jobs/applications/[id]/resume` instead,
 * which checks the application against the caller's tenant first. Moving these
 * objects under a tenant prefix would silently hand them to `/api/files/view`.
 *
 * The basename is a fresh uuid every time, so a caller can never propose a
 * path, overwrite an existing object, or learn one by guessing.
 *
 * NAMESPACED BY UPLOADER (052). Uploading now needs an account, so the key
 * carries the uploader's profile id: `applications/resumes/<userId>/<uuid>`.
 * `ownsResumeKey()` is what the apply and profile routes check before they
 * attach — or delete — a key a request names, so nobody can attach another
 * person's CV, or get it deleted, by quoting its key. Keys from before 052
 * have no owner segment and are simply never accepted from a request again.
 */
export function resumeKey(ext: string, ownerId: string): string {
  const clean = (/^[a-z0-9]+/.exec((ext || '').toLowerCase())?.[0] ?? '').slice(0, 8)
  const owner = /^[0-9a-f-]{36}$/i.test(ownerId) ? ownerId.toLowerCase() : 'unknown'
  const base = randomUUID()
  return `applications/resumes/${owner}/${clean ? `${base}.${clean}` : base}`
}

/** Was this key minted for this user by `resumeKey()`? */
export function ownsResumeKey(key: string | null | undefined, userId: string): boolean {
  if (!isResumeKey(key) || !/^[0-9a-f-]{36}$/i.test(userId)) return false
  return key!.startsWith(`applications/resumes/${userId.toLowerCase()}/`)
}

/** Is this an object this feature is willing to talk about at all? */
export function isResumeKey(key: string | null | undefined): boolean {
  if (!key) return false
  if (key.includes('..') || key.startsWith('/')) return false
  return key.startsWith('applications/resumes/')
}

export type ResumeCheck = { ok: true } | { ok: false; error: string }

/**
 * Verify the bytes that actually landed, and delete them if they are wrong.
 *
 * This is the real gate, and it has to be: `presignPut` deliberately does not
 * sign Content-Length (see its own header), so the size an applicant declared at
 * presign time is a claim, and the type they declared is a claim too. Both are
 * checked here, against the object itself, before any row is written.
 *
 * A rejected object is removed rather than left for the nightly sweep. It was
 * uploaded by an unauthenticated caller and it has already failed a check —
 * there is no reason for it to exist for another second.
 */
export async function validateResumeObject(key: string): Promise<ResumeCheck> {
  if (!isResumeKey(key)) return { ok: false, error: 'That file could not be found.' }

  const drop = async (error: string): Promise<ResumeCheck> => {
    try {
      await deleteObject(key)
    } catch (err) {
      // Best effort. The row is refused either way, and the nightly sweep in
      // /api/cron/jobs-gc collects anything this misses.
      console.warn('[jobs] could not remove a rejected résumé', err)
    }
    return { ok: false, error }
  }

  let size: number | undefined
  try {
    const head = await headObject(key)
    size = head.size
  } catch {
    return { ok: false, error: 'We could not find that file. Please attach your CV again.' }
  }

  if (!size) return drop('That file came through empty. Please attach your CV again.')
  if (size > MAX_RESUME_BYTES) return drop('Keep your CV under 10MB.')

  const head = await getObjectHead(key, SNIFF_BYTES)
  const mime = await sniffMime(head)

  /*
   * A null sniff means `file-type` did not recognise the container. For a
   * general upload that is survivable; here it is not. An anonymous caller
   * whose file we cannot identify has given us no reason to keep it.
   */
  if (!mime || !RESUME_MIMES.has(mime)) {
    return drop('Please attach your CV as a PDF or Word document.')
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

import { APPLICATION_STATUS_LABELS } from '@/lib/job-form'
export { APPLICATION_STATUS_LABELS }
export { JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS } from '@/lib/job-form'

const PERIOD_LABELS: Record<SalaryPeriod, string> = {
  hour: 'hour',
  day: 'day',
  month: 'month',
  year: 'year',
}

/**
 * The salary line, or null when there is not one to show.
 *
 * `salary_disclosed` is checked HERE rather than at each call site, so a page
 * cannot render a band the org chose to keep private by forgetting a condition.
 * Every surface that shows money goes through this function.
 */
export function salaryLabel(job: {
  salary_min: number | string | null
  salary_max: number | string | null
  salary_currency: string
  salary_period: SalaryPeriod | string
  salary_disclosed: boolean
}): string | null {
  if (!job.salary_disclosed) return null

  const min = job.salary_min === null ? null : Number(job.salary_min)
  const max = job.salary_max === null ? null : Number(job.salary_max)
  if (min === null && max === null) return null

  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: job.salary_currency || 'INR',
        maximumFractionDigits: 0,
      }).format(n)
    } catch {
      // An unknown currency code must not take a whole page down over a label.
      return `${job.salary_currency} ${Math.round(n).toLocaleString('en-US')}`
    }
  }

  const per = PERIOD_LABELS[(job.salary_period as SalaryPeriod) ?? 'year'] ?? 'year'
  const amount =
    min !== null && max !== null && min !== max
      ? `${fmt(min)} – ${fmt(max)}`
      : fmt((min ?? max) as number)

  return `${amount} / ${per}`
}

export { experienceLabel } from '@/lib/job-form'

export {
  EXPERIENCE_BANDS, POSTED_WITHIN, type ExperienceBand, type PostedWithin,
} from '@/lib/job-form'

/** Whether a posting has passed its own closing date. */
export function isExpired(closesAt: string | null): boolean {
  if (!closesAt) return false
  // Compared as a plain calendar day: `closes_at` is a `date`, and a job that
  // closes today should still accept an application filed today.
  return closesAt < new Date().toISOString().slice(0, 10)
}

/**
 * `skills` is `jsonb`, so it arrives as `unknown` and may be anything a previous
 * writer put there. Normalised once, here, rather than defended against on every
 * page that maps over it.
 */
export function toSkills(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 30)
}

/** The row shape every job query in the app selects. Keep it in one place. */
export const JOB_COLUMNS =
  'id, tenant_id, posted_by, title, description, responsibilities, requirements, ' +
  'department_id, employment_type, workplace, location, country, state, city, address, ' +
  'experience_min, experience_max, ' +
  'salary_min, salary_max, salary_currency, salary_period, salary_disclosed, openings, ' +
  'skills, status, published_at, closes_at, application_count, created_at, updated_at, ' +
  // 052 — public once the job is published; see PublicRecruiter.
  'recruiter_name, recruiter_title, recruiter_email, recruiter_phone, recruiter_linkedin_url, ' +
  'company_linkedin_url, client_name, duration, start_date_label, work_authorization'

/**
 * The recruiter block, or null when the org entered none of it — so the page can
 * leave the card out instead of rendering a column of dashes. Links are only
 * ever passed through when they are https (052 enforces it in the database too).
 */
function toRecruiter(row: Job): PublicJob['recruiter'] {
  const https = (v: string | null | undefined) => (v && /^https:\/\//i.test(v) ? v : null)
  const recruiter = {
    name: row.recruiter_name ?? null,
    title: row.recruiter_title ?? null,
    email: row.recruiter_email ?? null,
    phone: row.recruiter_phone ?? null,
    linkedinUrl: https(row.recruiter_linkedin_url),
    companyLinkedinUrl: https(row.company_linkedin_url),
  }
  return Object.values(recruiter).some(Boolean) ? recruiter : null
}

/** Map a `jobs` row to the public shape, resolving the salary rule on the way. */
export function toPublicJob(
  row: Job,
  company: PublicJob['company']
): PublicJob {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    responsibilities: row.responsibilities,
    requirements: row.requirements,
    employmentType: row.employment_type,
    workplace: row.workplace,
    location: row.location,
    experienceMin: row.experience_min,
    experienceMax: row.experience_max,
    salaryLabel: salaryLabel(row),
    openings: row.openings,
    skills: toSkills(row.skills),
    publishedAt: row.published_at,
    closesAt: row.closes_at,
    country: row.country,
    clientName: row.client_name ?? null,
    duration: row.duration ?? null,
    startDate: row.start_date_label ?? null,
    workAuthorization: row.work_authorization ?? null,
    recruiter: toRecruiter(row),
    company,
  }
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

/**
 * Who to tell when an application arrives.
 *
 * The org's active admins, or the platform's super admins for an OneclickHR
 * posting. Runs on whatever client the caller passes; the apply route passes the
 * admin client because the applicant has no session and RLS would return nothing.
 */
export async function jobNotificationRecipients(
  supabase: SupabaseClient,
  tenantId: string | null
): Promise<string[]> {
  const query = supabase
    .from('profiles')
    .select('email')
    .eq('is_active', true)
    .eq('role', tenantId ? 'org' : 'super_admin')
    .limit(10)

  const { data, error } = tenantId ? await query.eq('tenant_id', tenantId) : await query

  if (error) {
    console.warn('[jobs] could not resolve notification recipients', error.message)
    return []
  }
  return (data ?? [])
    .map((row) => (row as { email: string | null }).email)
    .filter((email): email is string => !!email)
}

/**
 * The 052 columns — recruiter contact and engagement details — from a parsed
 * `jobSchema`. One mapping for the four routes that create and edit jobs, so a
 * field cannot be saved by one console and silently dropped by another.
 */
export function engagementColumns(input: JobInput) {
  return {
    recruiter_name: input.recruiterName,
    recruiter_title: input.recruiterTitle,
    recruiter_email: input.recruiterEmail,
    recruiter_phone: input.recruiterPhone,
    recruiter_linkedin_url: input.recruiterLinkedinUrl,
    company_linkedin_url: input.companyLinkedinUrl,
    client_name: input.clientName,
    duration: input.duration,
    start_date_label: input.startDateLabel,
    work_authorization: input.workAuthorization,
  }
}

/**
 * Email an applicant that their application changed stage (052).
 *
 * Only for applications made from an account — applying requires one now, and
 * older anonymous ones get nothing new. Never throws: the stage change is
 * already saved, and a mail outage must not turn it into an error.
 */
export async function emailApplicantStatus(
  admin: SupabaseClient,
  applicationId: string,
  message: string | null
): Promise<void> {
  try {
    const { data } = await admin
      .from('job_applications')
      .select('full_name, email, status, applicant_profile_id, job:jobs(title, tenant_id)')
      .eq('id', applicationId)
      .maybeSingle()
    const row = data as {
      full_name: string
      email: string
      status: keyof typeof APPLICATION_STATUS_LABELS
      applicant_profile_id: string | null
      job: { title: string; tenant_id: string | null } | null
    } | null
    if (!row?.applicant_profile_id || !row.job) return

    let companyName = 'OneclickHR'
    let brandColor: string | undefined
    if (row.job.tenant_id) {
      const { data: tenant } = await admin
        .from('tenants')
        .select('name, primary_color')
        .eq('id', row.job.tenant_id)
        .maybeSingle()
      if (tenant) {
        companyName = (tenant as { name: string }).name
        brandColor = (tenant as { primary_color: string }).primary_color
      }
    }

    await sendApplicationStatusUpdate({
      to: row.email,
      applicantName: row.full_name,
      jobTitle: row.job.title,
      companyName,
      statusLabel: APPLICATION_STATUS_LABELS[row.status] ?? row.status,
      message,
      brandColor,
    })
  } catch (err) {
    console.warn('[jobs] could not email the applicant a status update', err)
  }
}
