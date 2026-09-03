import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink, MapPin, Users, Briefcase, CalendarClock, Wallet, Building2 } from 'lucide-react'
import { requireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { PageHeader, StatCard, StatusChip } from '@/components/ui/patterns'
import { Button } from '@/components/ui/button'
import { JOB_COLUMNS, JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS, experienceLabel, salaryLabel, toSkills } from '@/lib/jobs'
import { formatDateLabel, formatInstantLabel } from '@/lib/time'
import { ApplicantList, type ApplicantRow } from './applicant-list'
import type { Job, JobApplication } from '@/types/db'

export const metadata: Metadata = { title: 'Job' }
export const dynamic = 'force-dynamic'

/**
 * One posting and everyone who has applied to it.
 *
 * Both reads go through the user-scoped client, so `jobs_select` and
 * `job_applications_select` are what confine them to this tenant. There is no
 * `.eq('tenant_id', …)` here and there should not be — adding one would suggest
 * the policies are not trusted, and the next person would wonder which of the
 * two is actually doing the work.
 *
 * `resume_key` is selected but never sent to the browser: the list receives
 * `hasResume` instead. A CV is fetched through the authorized download route,
 * and a key on the page would be an object identifier sitting in a payload for
 * no reason at all.
 */
export default async function OrgJobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ application?: string }>
}) {
  await requireOrg()
  const { id } = await params
  const { application: openId } = await searchParams
  const supabase = await createSupabaseServerClient()

  const [{ data: jobData }, { data: applicationData }] = await Promise.all([
    supabase.from('jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('job_applications')
      .select(
        'id, full_name, email, phone, location, linkedin_url, portfolio_url, cover_letter, ' +
          'resume_key, years_experience, current_company, notice_period, source, status, ' +
          'org_notes, created_at'
      )
      .eq('job_id', id)
      .order('created_at', { ascending: false }),
  ])

  if (!jobData) notFound()
  const job = jobData as unknown as Job

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
  const workplaceLabel = JOB_WORKPLACE_LABELS[job.workplace]

  return (
    <div className="space-y-6">
      <Link
        href="/org/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All jobs
      </Link>

      <PageHeader
        title={job.title}
        description={[
          JOB_TYPE_LABELS[job.employment_type],
          JOB_WORKPLACE_LABELS[job.workplace],
          job.location,
        ]
          .filter(Boolean)
          .join(' · ')}
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

      {/*
        * THREE cards, not four, and salary is not one of them.
        *
        * A StatCard renders its value as a 28px bold number, which is right for
        * a count and wrong for a string. "₹12,00,000 – ₹18,00,000 / year" set
        * that way wraps to three heavy lines, and the published TIMESTAMP
        * overflowed the tile outright. Counts and a short date go in the cards;
        * everything descriptive goes in the fact row below, where a long value
        * is just a long value.
        */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Applicants" value={applications.length} icon={Users} accent />
        <StatCard label="Openings" value={job.openings} icon={Briefcase} />
        <StatCard
          label="Published"
          // `published_at` is a timestamptz — the INSTANT helper, not the one
          // for plain `date` columns, which printed the raw ISO string here.
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
          <Fact icon={MapPin} label="Location" value={job.location || workplaceLabel} />
          {experience ? <Fact icon={Building2} label="Experience" value={experience} /> : null}
        </dl>

        {/* Plain text with preserved line breaks — never markup. */}
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

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-muted">
          Applicants
        </h2>
        <ApplicantList applications={applications} initialOpenId={openId} />
      </div>
    </div>
  )
}

/**
 * One labelled fact.
 *
 * The same shape the public job page uses, so an admin previewing a role and a
 * candidate reading it see the details laid out the same way. Values wrap rather
 * than truncate — a salary range is worth a second line, and half a number is
 * worse than none.
 */
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
