import type { Metadata } from 'next'
import Link from 'next/link'
import { LayoutDashboard } from 'lucide-react'
import { loadContext } from '@/lib/auth/context'
import { homeFor } from '@/lib/auth/context'
import { appUrl } from '@/lib/env'

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
    template: '%s · Jobs at Oneclickhr',
  },
  description:
    'Open roles from organizations hiring through Oneclickhr. Browse and apply — no account needed.',
  metadataBase: new URL(appUrl()),
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'Oneclickhr Jobs',
  },
}

export default async function JobsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await loadContext()

  return (
    <div className="flex min-h-screen flex-col bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-card/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1100px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/jobs" className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              O
            </span>
            {/* The wordmark shrinks a step on a phone so it cannot push the
                sign-in and post-a-job buttons off the right edge. */}
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em] text-ink sm:text-[17px]">
              Oneclickhr
              <span className="ml-1.5 text-ink-muted">Jobs</span>
            </span>
          </Link>

          <nav className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
            {ctx ? (
              <Link
                href={homeFor(ctx.role)}
                className="focus-ring inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium text-ink-muted transition hover:text-ink"
              >
                <LayoutDashboard className="size-4" aria-hidden />
                My dashboard
              </Link>
            ) : (
              <>
                <a
                  href="https://oneclickhr.app"
                  className="focus-ring hidden rounded-lg px-3 py-2 font-medium text-ink-muted transition hover:text-ink sm:inline-flex"
                >
                  About Oneclickhr
                </a>
                <Link
                  href="/login"
                  className="focus-ring whitespace-nowrap rounded-lg px-2.5 py-2 font-medium text-ink-muted transition hover:text-ink sm:px-3"
                >
                  Sign in
                </Link>
                <Link
                  href="/signup"
                  className="focus-ring whitespace-nowrap rounded-lg bg-brand-600 px-3 py-2 font-medium text-white transition hover:bg-brand-700 sm:px-3.5"
                >
                  Post a job
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-line bg-card">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-2 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Oneclickhr. All rights reserved.</p>
          <p>
            Hiring for your own team?{' '}
            <Link href="/signup" className="font-medium text-brand-600 hover:underline">
              Post a role
            </Link>
            .
          </p>
        </div>
      </footer>
    </div>
  )
}
