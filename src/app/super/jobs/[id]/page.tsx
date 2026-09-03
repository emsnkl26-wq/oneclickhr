import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, Users, Briefcase, CalendarClock, Wallet, MapPin, Building2 } from 'lucide-react'
import { requireSuperAdmin } from '@/lib/auth/guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { PageHeader, StatCard, StatusChip } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import {
  JOB_COLUMNS, JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS, experienceLabel, salaryLabel, toSkills,
} from '@/lib/jobs'
import { formatDateLabel, formatInstantLabel } from '@/lib/time'
import { ApplicantList, type ApplicantRow } from '@/app/org/jobs/[id]/applicant-list'
import type { Job, JobApplication } from '@/types/db'

export const metadata: Metadata = { title: 'Job' }
export const dynamic = 'force-dynamic'

/**
 * One posting, from the platform console.
 *
 * The APPLICANT LIST IS ONLY RENDERED FOR OUR OWN POSTINGS.
 *
 * A super admin could read a customer's applicants — `job_applications_select`
 * grants it, and this page uses the service role anyway. It does not, and the
 * distinction is the same one drawn in /api/files/view: platform oversight
 * covers account state and moderation, not reading the CVs and phone numbers of
 * people who applied to a customer's job. Those belong to the hiring org.
 *
 * Everything needed to moderate — the title, the copy, the company — is here.
 * Nothing about the strangers who replied to it is.
 */
export default async function SuperJobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ application?: string }>
}) {
  await requireSuperAdmin()
  const { id } = await params
  const { application: openId } = await searchParams
  const admin = createAdminClient()

  const { data: jobData } = await admin.from('jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle()
  if (!jobData) notFound()
  const job = jobData as unknown as Job

  const isPlatform = !job.tenant_id

  const [{ data: tenant }, { data: applicationData }] = await Promise.all([
    job.tenant_id
      ? admin.from('tenants').select('name, slug').eq('id', job.tenant_id).maybeSingle()
      : Promise.resolve({ data: null }),
    isPlatform
      ? admin
          .from('job_applications')
          .select(
            'id, full_name, email, phone, location, linkedin_url, portfolio_url, cover_letter, ' +
              'resume_key, years_experience, current_company, notice_period, source, status, ' +
              'org_notes, created_at'
          )
          .eq('job_id', id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  const companyName = isPlatform
    ? 'Oneclickhr'
    : ((tenant as { name: string } | null)?.name ?? 'Unknown workspace')

  const applications: ApplicantRow[] = (
    (applicationData ?? []) as unknown as JobApplication[]
  ).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    location: row.location,
    linkedinUrl: row.linkedin_url,
    portfolioUrl: row.portfolio_url,
    coverLetter: row.cover_letter,
    hasResume: !!row.resume_key,
    yearsExperience: row.years_experience === null ? null : Number(row.years_experience),
    currentCompany: row.current_company,
    noticePeriod: row.notice_period,
    source: row.source,
    status: row.status,
    orgNotes: row.org_notes,
    createdAt: row.created_at,
  }))

  const pay = salaryLabel(job)
  const experience = experienceLabel(job.experience_min, job.experience_max)
  const skills = toSkills(job.skills)

  return (
    <div className="space-y-6">
      <Link
        href="/super/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All jobs
      </Link>

      <PageHeader
        title={job.title}
        description={`${companyName} · ${JOB_TYPE_LABELS[job.employment_type]} · ${
          JOB_WORKPLACE_LABELS[job.workplace]
        }${job.location ? ` · ${job.location}` : ''}`}
        actions={
          job.status === 'published' ? (
            <Button variant="secondary" asChild>
              <a href={`/jobs/${job.id}`} target="_blank" rel="noreferrer">
                <ExternalLink />
                View on the portal
              </a>
            </Button>
          ) : (
            <StatusChip status={job.status} />
          )
        }
      />

      {/* Counts and a short date only — see the note on the org page for why a
          salary range and a timestamp do not belong in a 28px number slot. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Applicants" value={job.application_count} icon={Users} accent />
        <StatCard label="Openings" value={job.openings} icon={Briefcase} />
        <StatCard
          label="Published"
          value={formatInstantLabel(job.published_at)}
          hint={job.closes_at ? `Closes ${formatDateLabel(job.closes_at)}` : undefined}
          icon={CalendarClock}
          tone="indigo"
        />
      </div>

      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          The posting
        </h2>

        <dl className="mt-4 grid gap-x-6 gap-y-3 border-b border-line pb-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact icon={Wallet} label="Salary" value={pay ?? 'Not shown to candidates'} />
          <Fact
            icon={MapPin}
            label="Location"
            value={job.location || JOB_WORKPLACE_LABELS[job.workplace]}
          />
          {experience ? <Fact icon={Building2} label="Experience" value={experience} /> : null}
        </dl>

        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {job.description}
        </p>
        {job.responsibilities ? (
          <>
            <h3 className="mt-5 text-sm font-semibold text-ink">Responsibilities</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {job.responsibilities}
            </p>
          </>
        ) : null}
        {job.requirements ? (
          <>
            <h3 className="mt-5 text-sm font-semibold text-ink">Requirements</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {job.requirements}
            </p>
          </>
        ) : null}
        {skills.length ? (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {skills.map((skill) => (
              <span
                key={skill}
                className="rounded-full bg-page px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-inset ring-line"
              >
                {skill}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {isPlatform ? (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">
            Applicants
          </h2>
          <ApplicantList
            applications={applications}
            initialOpenId={openId}
            endpoint="/api/super/jobs/applications"
          />
        </div>
      ) : (
        <div className="card-surface p-5 text-sm leading-relaxed text-ink-muted">
          <p>
            <strong className="text-ink">
              {job.application_count} {job.application_count === 1 ? 'person has' : 'people have'}{' '}
              applied
            </strong>{' '}
            for this role. Their details belong to {companyName} and are only visible inside that
            workspace.
          </p>
          <p className="mt-2">
            You can unpublish this posting from the jobs list if it should not be on the portal.
            That is recorded in {companyName}&apos;s audit log under your name.
          </p>
        </div>
      )}
    </div>
  )
}

/** Same shape as the org console's, so a moderator and an admin read alike. */
function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Wallet
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs text-ink-muted">{label}</dt>
        <dd className="break-words text-sm font-medium text-ink">{value}</dd>
      </div>
    </div>
  )
}
