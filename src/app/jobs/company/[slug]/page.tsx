import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Globe, MapPin } from 'lucide-react'
import { getPublicCompany, listPublicJobs } from '@/lib/jobs-public'
import { appUrl } from '@/lib/env'
import { CompanyMark, JobCard } from '../../job-card'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/**
 * One organization's openings — the link an org puts on its own careers page.
 *
 * A company with nothing published has no page at all (see `getPublicCompany`).
 * That is the difference between a careers page and a public directory of every
 * customer this platform has, and the latter is not ours to publish.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const company = await getPublicCompany((await params).slug)
  if (!company) return { title: 'Not found', robots: { index: false, follow: false } }

  return {
    title: `Jobs at ${company.name}`,
    description: `Open roles at ${company.name}. Browse and apply — no account needed.`,
    alternates: { canonical: `${appUrl()}/jobs/company/${(await params).slug}` },
  }
}

export default async function CompanyJobsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { slug } = await params
  const { page: rawPage } = await searchParams

  const company = await getPublicCompany(slug)
  if (!company) notFound()

  const page = Math.max(1, parseInt(rawPage ?? '', 10) || 1)
  const feed = await listPublicJobs({ company: slug, page })

  return (
    <div className="space-y-8">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All roles
      </Link>

      <header className="flex items-start gap-4">
        <CompanyMark company={company} size="lg" />
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">
            Jobs at {company.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span>
              {feed.total} open {feed.total === 1 ? 'role' : 'roles'}
            </span>
            {company.location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden />
                {company.location}
              </span>
            ) : null}
            {company.website ? (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1.5 hover:text-ink"
              >
                <Globe className="size-3.5" aria-hidden />
                Website
              </a>
            ) : null}
          </div>
        </div>
      </header>

      <div className="space-y-3">
        {feed.jobs.map((job) => (
          // The company is the page — repeating it on every card is noise.
          <JobCard key={job.id} job={job} showCompany={false} />
        ))}
      </div>
    </div>
  )
}
