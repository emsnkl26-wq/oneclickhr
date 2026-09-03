import Link from 'next/link'
import { MapPin, Clock, Wallet, Building2 } from 'lucide-react'
import { JOB_TYPE_LABELS, JOB_WORKPLACE_LABELS, experienceLabel } from '@/lib/jobs'
import { formatInstantLabel } from '@/lib/time'
import type { PublicJob } from '@/types/db'

/**
 * One posting in the feed.
 *
 * A server component with no interactivity, deliberately — the whole card is a
 * link, so there is nothing here that needs to ship JavaScript to a visitor who
 * may only ever look at one page.
 */
export function JobCard({ job, showCompany = true }: { job: PublicJob; showCompany?: boolean }) {
  const experience = experienceLabel(job.experienceMin, job.experienceMax)

  return (
    <Link
      href={`/jobs/${job.id}`}
      className="card-surface focus-ring block p-5 transition hover:shadow-card"
    >
      <div className="flex items-start gap-4">
        {showCompany ? <CompanyMark company={job.company} /> : null}

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold text-ink">{job.title}</h2>
          {/*
            * `truncate` has to sit on the TEXT, not on the flex row.
            * `text-overflow` does nothing to a flex container — it was on the
            * `<p>`, so a long company name pushed the badge out of the card
            * instead of ellipsing itself.
            */}
          {showCompany ? (
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-muted">
              <span className="truncate">{job.company.name}</span>
              {job.company.isPlatform ? (
                <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                  Oneclickhr
                </span>
              ) : null}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5" aria-hidden />
              {JOB_TYPE_LABELS[job.employmentType]}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden />
              {job.location || JOB_WORKPLACE_LABELS[job.workplace]}
              {job.location && job.workplace !== 'onsite'
                ? ` · ${JOB_WORKPLACE_LABELS[job.workplace]}`
                : ''}
            </span>
            {experience ? (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-3.5" aria-hidden />
                {experience}
              </span>
            ) : null}
            {/*
              * `salaryLabel` is already null unless the org chose to advertise —
              * the rule lives in one function so no page can show a band that was
              * meant to stay private by forgetting a condition.
              */}
            {job.salaryLabel ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                <Wallet className="size-3.5" aria-hidden />
                {job.salaryLabel}
              </span>
            ) : null}
          </div>

          {job.skills.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.skills.slice(0, 6).map((skill) => (
                <span
                  key={skill}
                  className="rounded-full bg-page px-2.5 py-0.5 text-[11px] font-medium text-ink-muted ring-1 ring-inset ring-line"
                >
                  {skill}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <span className="hidden shrink-0 text-xs text-ink-muted sm:block">
          {job.publishedAt ? formatInstantLabel(job.publishedAt) : ''}
        </span>
      </div>
    </Link>
  )
}

/**
 * The company's logo, or its initial.
 *
 * `next/image` is deliberately not used: the src is `/api/jobs/logo`, which 302s
 * to a signed R2 URL on a host the optimizer is not configured to fetch from,
 * and the signature expires — so an optimized, cached variant would break in a
 * way nothing on the page could explain. A plain `<img>` follows the redirect
 * and re-requests when it needs to.
 */
export function CompanyMark({
  company,
  size = 'sm',
}: {
  company: PublicJob['company']
  size?: 'sm' | 'lg'
}) {
  const box = size === 'lg' ? 'size-14 text-lg' : 'size-11 text-sm'

  if (company.logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={company.logoUrl}
        alt=""
        className={`${box} shrink-0 rounded-xl border border-line bg-card object-contain p-1.5`}
        loading="lazy"
      />
    )
  }

  return (
    <span
      className={`${box} grid shrink-0 place-items-center rounded-xl bg-page font-bold text-ink-muted ring-1 ring-inset ring-line`}
      aria-hidden
    >
      {company.name.charAt(0).toUpperCase()}
    </span>
  )
}
