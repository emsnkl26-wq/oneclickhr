import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Globe, MapPin } from 'lucide-react'
import { getPublicCompany, listPublicJobs, FEED_PER_PAGE } from '@/lib/jobs-public'
import { loadJobViewer } from '@/lib/job-viewer-server'
import { appUrl } from '@/lib/env'
import { BRAND, BRAND_ASSETS, brandOgImage } from '@/lib/brand'
import { CompanyMark } from '../../company-mark'
import { JobBoard } from '../../job-board'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/**
 * A company's website as a safe link: `https://` added to a bare host (which
 * is how a workspace's claimed domain is stored), and anything that is not an
 * http(s) URL dropped rather than rendered as an href.
 */
function websiteHref(value: string | null): string | null {
  if (!value) return null
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

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
    description: `Open roles at ${company.name}. Browse and apply with a free ${BRAND.jobsName} account.`,
    alternates: { canonical: `${appUrl()}/jobs/company/${(await params).slug}` },
    // Restated: this segment's `openGraph` would otherwise replace the layout's,
    // card image included. Same reason as in jobs/[id]/page.tsx.
    openGraph: {
      type: 'website',
      siteName: BRAND.jobsName,
      title: `Jobs at ${company.name}`,
      images: [brandOgImage(BRAND_ASSETS.ogJobs, `Jobs at ${company.name}`)],
    },
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
  const [feed, viewer] = await Promise.all([listPublicJobs({ company: slug, page }), loadJobViewer()])
  const website = websiteHref(company.website)

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-10 sm:px-6">
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
            {company.location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" aria-hidden />
                {company.location}
              </span>
            ) : null}
            {website ? (
              <a
                href={website}
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

      <JobBoard
        jobs={feed.jobs}
        total={feed.total}
        page={feed.page}
        perPage={FEED_PER_PAGE}
        filters={{ q: '', types: [], workplaces: [], experience: [], sort: 'newest' }}
        viewer={viewer}
        showFilters={false}
      />
    </div>
  )
}
