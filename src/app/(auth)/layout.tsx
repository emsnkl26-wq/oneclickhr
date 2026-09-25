import Link from 'next/link'
import { BrandLogo } from '@/components/brand/logo'
import { BRAND } from '@/lib/brand'

/**
 * The signed-out frame: a dark brand panel beside a white form card, collapsing
 * to the form alone on small screens. Anyone who reaches this screen is either
 * new or locked out, so the left panel says what the product is rather than
 * decorating.
 *
 * The panel is charcoal in BOTH themes (`bg-charcoal`, not `bg-sidebar`, which is
 * white in the light theme) and so carries the dark-surface lockup and fixed
 * white type. Only the form half follows the theme.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-page">
      <aside className="relative hidden w-[42%] max-w-[560px] flex-col justify-between overflow-hidden bg-charcoal p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full opacity-40 blur-3xl"
          style={{ background: `radial-gradient(circle, ${BRAND.colors.primary} 0%, transparent 70%)` }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 size-[380px] rounded-full opacity-25 blur-3xl"
          style={{ background: `radial-gradient(circle, ${BRAND.colors.primaryDark} 0%, transparent 70%)` }}
        />

        <Link href="/" aria-label={BRAND.name} className="relative inline-flex">
          <BrandLogo variant="horizontal" tone="dark" height={40} priority />
        </Link>

        <div className="relative max-w-sm">
          <h2 className="text-[30px] font-bold leading-[1.15] tracking-[-0.03em] text-white">
            Everything your team needs, in one calm place.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/60">
            Attendance, leave, payroll, work authorization and tasks — with each
            organization&apos;s data kept strictly to itself.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {[
              'Isolated workspace per organization',
              'Shift clock-in with automatic hours',
              'H-1B expiry reminders that never double-send',
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/50">
          © {new Date().getFullYear()} {BRAND.name}. All rights reserved.
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <Link href="/" aria-label={BRAND.name} className="mb-8 inline-flex lg:hidden">
            <BrandLogo variant="horizontal" height={34} priority />
          </Link>
          {children}

          {/*
            The one door on this screen that needs no account. Job seekers land
            on /login from a shared posting more often than you would think, and
            without this the only way out is the back button.
          */}
          <p className="mt-8 border-t border-line pt-5 text-center text-xs text-ink-muted">
            Looking for a job?{' '}
            <Link href="/jobs" className="font-medium text-brand-ink hover:underline">
              Browse open roles
            </Link>{' '}
            — no account needed.
          </p>
        </div>
      </main>
    </div>
  )
}
