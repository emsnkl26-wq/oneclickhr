import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin, Clock, Wallet, Users, CalendarClock, Building2 } from 'lucide-react'
import { getPublicJob } from '@/lib/jobs-public'
import { loadContext } from '@/lib/auth/context'
import { JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS, experienceLabel, isExpired } from '@/lib/jobs'
import { formatDateLabel } from '@/lib/time'
import { appUrl } from '@/lib/env'
import { CompanyMark } from '../job-card'
import { ApplyForm } from './apply-form'
import type { PublicJob } from '@/types/db'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * A real title and description per posting, because these pages are the ones
 * search engines and link previews actually see. Falls back silently for a job
 * that no longer exists — `generateMetadata` throwing would turn a 404 into a
 * 500.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const job = await getPublicJob((await params).id)
  if (!job) return { title: 'Job not found', robots: { index: false, follow: false } }

  const where = job.location || JOB_WORKPLACE_LABELS[job.workplace]
  const description = job.description.replace(/\s+/g, ' ').slice(0, 200)

  return {
    title: `${job.title} at ${job.company.name}`,
    description,
    alternates: { canonical: `${appUrl()}/jobs/${job.id}` },
    openGraph: {
      title: `${job.title} · ${job.company.name}`,
      description: `${JOB_TYPE_LABELS[job.employmentType]} · ${where}`,
      url: `${appUrl()}/jobs/${job.id}`,
      type: 'article',
    },
  }
}

export default async function PublicJobPage({ params }: Params) {
  const { id } = await params
  const job = await getPublicJob(id)

  // Covers "draft", "closed" and "never existed" alike — an outsider must not be
  // able to tell a withdrawn posting from one that was never there.
  if (!job) notFound()

  /*
   * Opportunistic, never a gate. A signed-in employee gets their own details
   * filled in; everyone else sees the same form. `super_admin` is excluded —
   * prefilling a platform administrator's address into a job application is
   * never what they meant to do.
   */
  const ctx = await loadContext()
  const prefill =
    ctx && ctx.role === 'employee'
      ? { fullName: ctx.fullName ?? '', email: ctx.email, phone: '' }
      : undefined

  const experience = experienceLabel(job.experienceMin, job.experienceMax)
  const closed = isExpired(job.closesAt)

  return (
    <div className="space-y-6">
      <script
        type="application/ld+json"
        // Built from values this page already renders, serialized by
        // JSON.stringify — no interpolation of raw strings into the script body.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingLd(job)) }}
      />

      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All roles
      </Link>

      <header className="card-surface p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <CompanyMark company={job.company} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink">
              {job.title}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px] text-ink-muted">
              {job.company.slug ? (
                <Link
                  href={`/jobs/company/${job.company.slug}`}
                  className="font-medium text-ink hover:underline"
                >
                  {job.company.name}
                </Link>
              ) : (
                <span className="font-medium text-ink">{job.company.name}</span>
              )}
              {job.company.isPlatform ? (
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                  Hiring for Oneclickhr
                </span>
              ) : null}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-line pt-5 sm:grid-cols-2 lg:grid-cols-3">
          <Fact icon={Clock} label="Employment" value={JOB_TYPE_LABELS[job.employmentType]} />
          <Fact
            icon={MapPin}
            label="Location"
            value={`${job.location || '—'}${
              job.location ? ` · ${JOB_WORKPLACE_LABELS[job.workplace]}` : JOB_WORKPLACE_LABELS[job.workplace]
            }`}
          />
          {experience ? <Fact icon={Building2} label="Experience" value={experience} /> : null}
          {job.salaryLabel ? <Fact icon={Wallet} label="Salary" value={job.salaryLabel} /> : null}
          <Fact
            icon={Users}
            label="Openings"
            value={String(job.openings)}
          />
          {job.closesAt ? (
            <Fact
              icon={CalendarClock}
              label="Applications close"
              value={formatDateLabel(job.closesAt)}
            />
          ) : null}
        </dl>
      </header>

      <article className="card-surface space-y-6 p-5 sm:p-6">
        <Section title="About the role" body={job.description} />
        {job.responsibilities ? (
          <Section title="Responsibilities" body={job.responsibilities} />
        ) : null}
        {job.requirements ? <Section title="Requirements" body={job.requirements} /> : null}

        {job.skills.length ? (
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
              Skills
            </h2>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.skills.map((skill) => (
                <span
                  key={skill}
                  className="rounded-full bg-page px-3 py-1 text-xs font-medium text-ink ring-1 ring-inset ring-line"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </article>

      {closed ? (
        <div className="card-surface p-8 text-center">
          <h2 className="text-lg font-semibold text-ink">Applications have closed</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
            This role stopped accepting applications on {formatDateLabel(job.closesAt)}. There may
            be something else that suits you.
          </p>
          <Link
            href="/jobs"
            className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline"
          >
            Browse open roles
          </Link>
        </div>
      ) : (
        <ApplyForm jobId={job.id} jobTitle={job.title} prefill={prefill} />
      )}
    </div>
  )
}

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
      <div className="min-w-0">
        <dt className="text-xs text-ink-muted">{label}</dt>
        {/* Wraps rather than truncates. A salary range or a long location is
            worth a second line — half a number is worse than none. */}
        <dd className="break-words text-sm font-medium text-ink">{value}</dd>
      </div>
    </div>
  )
}

/** Plain text with line breaks preserved. Never markup — see the portal notes. */
function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{body}</p>
    </div>
  )
}

/**
 * schema.org JobPosting.
 *
 * This is what puts a role into Google Jobs and the aggregators that read it,
 * which for a portal linked from one marketing page is most of the reach it will
 * ever have. `baseSalary` is emitted ONLY when the org chose to advertise —
 * `salaryLabel` is already null otherwise, and publishing a band in structured
 * data that the visible page hides would leak it to every scraper.
 */
function jobPostingLd(job: PublicJob): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: [job.description, job.responsibilities, job.requirements]
      .filter(Boolean)
      .join('\n\n'),
    datePosted: job.publishedAt,
    validThrough: job.closesAt || undefined,
    employmentType: job.employmentType.toUpperCase(),
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company.name,
      sameAs: job.company.website || undefined,
    },
    jobLocationType: job.workplace === 'remote' ? 'TELECOMMUTE' : undefined,
    jobLocation: job.location
      ? {
          '@type': 'Place',
          address: { '@type': 'PostalAddress', addressLocality: job.location },
        }
      : undefined,
    totalJobOpenings: job.openings,
    skills: job.skills.length ? job.skills.join(', ') : undefined,
    url: `${appUrl()}/jobs/${job.id}`,
  }
}
