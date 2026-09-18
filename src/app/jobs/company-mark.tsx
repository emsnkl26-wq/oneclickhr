'use client'

import * as React from 'react'
import type { PublicJob } from '@/types/db'

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
  // A logo that fails to load (removed, expired) falls back to the initial
  // instead of showing the browser's broken-image icon.
  const [failed, setFailed] = React.useState(false)

  if (company.logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={company.logoUrl}
        alt=""
        className={`${box} shrink-0 rounded-xl border border-line bg-card object-contain p-1.5`}
        loading="lazy"
        onError={() => setFailed(true)}
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
