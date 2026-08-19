import Link from 'next/link'

/**
 * The signed-out frame: a dark brand panel beside a white form card, collapsing
 * to the form alone on small screens. Anyone who reaches this screen is either
 * new or locked out, so the left panel says what the product is rather than
 * decorating.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-page">
      <aside className="relative hidden w-[42%] max-w-[560px] flex-col justify-between overflow-hidden bg-sidebar p-12 lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-[420px] rounded-full opacity-25 blur-3xl"
          style={{ background: 'radial-gradient(circle, #C41E33 0%, transparent 70%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-20 size-[380px] rounded-full opacity-15 blur-3xl"
          style={{ background: 'radial-gradient(circle, #C41E33 0%, transparent 70%)' }}
        />

        <Link href="/" className="relative flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            O
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-white">
            Oneclickhr
          </span>
        </Link>

        <div className="relative max-w-sm">
          <h2 className="text-[30px] font-bold leading-[1.15] tracking-[-0.03em] text-white">
            Everything your team needs, in one calm place.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-sidebar-muted">
            Attendance, leave, payroll, work authorization and tasks — with each
            organization&apos;s data kept strictly to itself.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-sidebar-fg/80">
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

        <p className="relative text-xs text-sidebar-muted">
          © {new Date().getFullYear()} Oneclickhr. All rights reserved.
        </p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <Link href="/" className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              O
            </span>
            <span className="text-[17px] font-semibold tracking-[-0.01em]">Oneclickhr</span>
          </Link>
          {children}
        </div>
      </main>
    </div>
  )
}
