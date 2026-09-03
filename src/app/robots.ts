import type { MetadataRoute } from 'next'
import { appUrl } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Deny everything, then allow the job portal.
 *
 * The root layout sets `robots: { index: false, follow: false }` on every page,
 * and this is the site-level statement of the same rule — belt and braces,
 * because a `noindex` meta tag only works on a page a crawler has already
 * fetched, while a disallow stops the fetch.
 *
 * `/jobs` is carved out because it is the one part of this product meant to be
 * found. Note what is NOT carved out: `/org/jobs` and `/super/jobs` are the
 * admin half of the same feature. `Disallow: /org/` covers them, and the order
 * matters — `Allow` is matched by specificity, not by position, so the narrower
 * `/jobs` rule wins over `Disallow: /` without reopening anything else.
 *
 * This is not a security control. Anything genuinely private is behind
 * middleware and RLS; a robots file only asks politely.
 */
export default function robots(): MetadataRoute.Robots {
  const base = appUrl()

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/jobs'],
        disallow: [
          '/',
          '/org/',
          '/super/',
          '/employee/',
          '/api/',
          '/login',
          '/employee-login',
          '/signup',
          '/onboarding',
        ],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  }
}
