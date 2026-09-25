import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin } from 'lucide-react'
import { getPublicJob } from '@/lib/jobs-public'
import { loadJobViewer } from '@/lib/job-viewer-server'
import { JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS, isExpired } from '@/lib/jobs'
import { formatInstantLabel } from '@/lib/time'
import { appUrl } from '@/lib/env'
import { CompanyMark } from '../company-mark'
import { JobDescription, JobSummary, RecruiterContact } from '../job-details'
import { JobApplyPanel } from './job-apply-panel'
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

  const viewer = await loadJobViewer()
  const closed = isExpired(job.closesAt)

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <script
        type="application/ld+json"
        // Built from values this page already renders, serialized by JSON.stringify.
        // `<` is escaped too, so a description holding "</script>" cannot end this tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingLd(job)).replace(/</g, '\\u003c') }}
      />

      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All roles
      </Link>

      <header className="card-surface p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <CompanyMark company={job.company} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
                {JOB_TYPE_LABELS[job.employmentType]}
              </span>
              <span className="rounded-full bg-page px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink ring-1 ring-inset ring-line">
                {JOB_WORKPLACE_LABELS[job.workplace]}
              </span>
            </div>
            <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">
              {job.title}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-ink-muted">
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
              {job.location ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-4" aria-hidden />
                  {job.location}
                </span>
              ) : null}
              {job.publishedAt ? <span>Posted {formatInstantLabel(job.publishedAt)}</span> : null}
            </p>
          </div>
          <div className="sm:w-80">
            <JobApplyPanel job={job} viewer={viewer} closed={closed} />
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article className="card-surface p-5 sm:p-6">
          <JobDescription job={job} />
        </article>
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <JobSummary job={job} />
          <RecruiterContact job={job} />
        </aside>
      </div>
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
