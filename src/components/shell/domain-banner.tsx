'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShieldCheck, ShieldAlert, ArrowRight } from 'lucide-react'
import { deadlineLabel } from '@/lib/domain'

/**
 * The standing prompt to prove the company website.
 *
 * NOT dismissible. As of 061 the countdown it shows is REAL: a workspace that
 * reaches the deadline unverified is paused, and this banner is the only
 * warning anybody gets. So it names the consequence rather than hinting at it —
 * the old copy ("Everything keeps working — but please get this done") would
 * now be a lie, and a lie told right up until the morning the product stops.
 *
 * It never renders in the overdue state any more: past the deadline the guard
 * redirects to /verify-domain and the shell this sits in is not reached at all.
 * The red tone is kept for the LAST DAY, which is the moment it is worth it.
 */
export function DomainBanner({
  domain, daysLeft,
}: {
  domain: string | null
  /** Computed on the server — see `daysUntilDeadline`. Null means no deadline. */
  daysLeft: number | null
}) {
  const pathname = usePathname()
  if (pathname?.startsWith('/org/settings/domain')) return null

  const hasDomain = !!domain
  const days = daysLeft
  // The last day of a three-day window. Two tones only — a gradient of urgency
  // across three days would just read as noise.
  const urgent = days !== null && days <= 1

  const tone = urgent
    ? {
        wrap: 'border-danger/30 bg-danger/5',
        tile: 'bg-danger/10 text-danger',
        title: 'text-danger',
        body: 'text-danger/90',
        button: 'bg-danger hover:bg-danger/90',
      }
    : {
        wrap: 'border-amber-200 bg-amber-50',
        tile: 'bg-amber-100 text-amber-700',
        title: 'text-amber-900',
        body: 'text-amber-800',
        button: 'bg-amber-900 hover:bg-amber-950',
      }

  const Icon = urgent ? ShieldAlert : ShieldCheck

  return (
    <div
      className={`mb-5 flex flex-col gap-3 rounded-xl border px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between ${tone.wrap}`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-px grid size-8 shrink-0 place-items-center rounded-lg ${tone.tile}`}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className={`text-[13px] font-semibold ${tone.title}`}>
            {hasDomain ? 'Verify your company website' : 'Add your company website'}
            {days !== null ? (
              <span className="font-medium"> — {deadlineLabel(days)}</span>
            ) : null}
          </p>
          <p className={`mt-0.5 text-[13px] leading-relaxed ${tone.body}`}>
            {hasDomain ? (
              <>
                Confirm that <strong className="font-semibold">{domain}</strong> belongs to you, so
                nobody else can open a second workspace for your company.
              </>
            ) : (
              <>
                Tell us your website and confirm it, so nobody else can open a second workspace for
                your company.
              </>
            )}{' '}
            {days !== null
              ? 'The workspace is paused for everyone on your team if this is not done in time.'
              : 'It takes a minute.'}
          </p>
        </div>
      </div>

      <Link
        href="/org/settings/domain"
        className={`focus-ring inline-flex h-9 shrink-0 items-center justify-center gap-1.5 self-start rounded-lg px-3.5 text-[13px] font-medium text-white transition-colors sm:self-auto ${tone.button}`}
      >
        {hasDomain ? 'Verify domain' : 'Add website'}
        <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </div>
  )
}

