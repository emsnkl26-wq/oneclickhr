import type { Metadata } from 'next'
import Link from 'next/link'
import { Briefcase, LayoutDashboard } from 'lucide-react'
import { loadContext } from '@/lib/auth/context'
import { homeFor } from '@/lib/auth/context'
import { appUrl } from '@/lib/env'
import { BrandLogo } from '@/components/brand/logo'
import { BRAND, BRAND_ASSETS, brandOgImage } from '@/lib/brand'

/**
 * The public frame — the only unauthenticated layout in this product other than
 * the sign-in screens.
 *
 * TWO THINGS IT DOES THAT NO OTHER LAYOUT DOES:
 *
 * 1. It OVERRIDES the root's `robots: { index: false, follow: false }`. That
 *    blanket noindex is right for every other page here and fatal for this one:
 *    a job portal a crawler cannot read is a job portal nobody finds. Only the
 *    `/jobs` subtree flips it, and `src/app/robots.ts` says the same thing again
 *    at the site level.
 *
 * 2. It calls `loadContext()` rather than a guard. Nobody is turned away — the
 *    context is used for exactly one thing, a way back to the dashboard for a
 *    visitor who turns out to be signed in. A guard here would defeat the point
 *    of the feature.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ DO NOT ADD A `loading.tsx` ANYWHERE UNDER /jobs.                       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * There was one, and it had to come out. A `loading.tsx` is a Suspense
 * boundary, so Next flushes the shell — and therefore commits HTTP 200 — before
 * the page body runs. `notFound()` afterwards still renders the right UI, but
 * the status stays 200: a SOFT 404.
 *
 * Everywhere else in this app that would be cosmetic. Here it is not. Job
 * postings close constantly, so "this URL used to be a job and is not any more"
 * is the ordinary case rather than an edge case, and a crawler that gets 200 for
 * it keeps the dead role in the index and marks the site down for soft 404s.
 * Measured: with the file present `/jobs/<removed-id>` answered 200; without it,
 * 404.
 *
 * Nothing is really lost. These pages are server-rendered from a single indexed
 * query, and `RouteProgress` in the root layout already acknowledges the click
 * for anyone navigating within the app. The authenticated consoles at /org/jobs
 * and /super/jobs keep their skeletons — nobody crawls those.
 */
export const metadata: Metadata = {
  title: {
    default: 'Jobs',
    template: `%s · Jobs at ${BRAND.name}`,
  },
  description:
    `Open roles from organizations hiring through ${BRAND.name}. Browse by country and apply with a free account.`,
  metadataBase: new URL(appUrl()),
  robots: { index: true, follow: true },
  /*
   * Restated here rather than inherited: a segment that sets `openGraph` REPLACES
   * the parent's whole object, images included, so leaving them out would drop
   * the link-preview card from every job page.
   */
  openGraph: {
    type: 'website',
    siteName: BRAND.jobsName,
    images: [brandOgImage(BRAND_ASSETS.ogJobs, `${BRAND.jobsName} — open roles`)],
  },
  twitter: {
    card: 'summary_large_image',
    images: [BRAND_ASSETS.ogJobs.src],
  },
}

export default async function JobsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await loadContext()

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/jobs" aria-label={BRAND.jobsName} className="flex min-w-0 items-center gap-2.5">
            {/* The lockup shrinks a step on a phone so it cannot push the
                sign-in buttons off the right edge. */}
            <BrandLogo variant="horizontal" height={32} priority alt="" className="h-6 w-auto sm:h-8" />
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink-muted sm:text-[17px]">
              Jobs
            </span>
          </Link>

          <nav className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
            {ctx ? (
              <Link
                href={homeFor(ctx.role)}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium text-ink-muted transition hover:text-ink"
              >
                {ctx.role === 'candidate' ? (
                  <Briefcase className="size-4" aria-hidden />
                ) : (
                  <LayoutDashboard className="size-4" aria-hidden />
                )}
                {ctx.role === 'candidate' ? 'My applications' : 'My dashboard'}
              </Link>
            ) : (
              <>
                {/* For employers — a different door, so it stays quiet here. */}
                <Link
                  href="/signup"
                  className="focus-ring hidden rounded-lg px-3 py-2 font-medium text-ink-muted transition hover:text-ink md:inline-flex"
                >
                  Post a job
                </Link>
                <Link
                  href="/jobs/login"
                  className="focus-ring whitespace-nowrap rounded-lg px-2.5 py-2 font-medium text-ink-muted transition hover:text-ink sm:px-3"
                >
                  Sign in
                </Link>
                <Link
                  href="/jobs/signup"
                  className="focus-ring whitespace-nowrap rounded-lg bg-brand-600 px-3 py-2 font-medium text-white transition hover:bg-brand-700 sm:px-3.5"
                >
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Pages lay out their own width: the board's hero runs edge to edge. */}
      <main className="w-full flex-1">{children}</main>

      <footer className="border-t border-line bg-card">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {BRAND.name}. All rights reserved.</p>
          <p>
            Hiring for your own team?{' '}
            <Link href="/signup" className="font-medium text-brand-ink hover:underline">
              Post a role
            </Link>
            .
          </p>
        </div>
      </footer>
    </div>
  )
}
