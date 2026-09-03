import type { MetadataRoute } from 'next'
import { appUrl } from '@/lib/env'
import { listPublicJobIds, listAdvertisingCompanySlugs } from '@/lib/jobs-public'

export const dynamic = 'force-dynamic'

/**
 * Published jobs and the companies advertising them. Nothing else.
 *
 * Every URL here comes from `jobs-public.ts`, which cannot return anything that
 * is not `status = 'published'` — so this file has no filtering of its own to get
 * wrong. That is deliberate: a sitemap is the one place where a leaked
 * identifier is not merely exposed but actively handed to every crawler on the
 * internet, and the way to make that impossible is to have no second source of
 * truth about what is public.
 *
 * Fails to an empty sitemap rather than a 500. A crawler that gets a server error
 * backs off and retries the whole site later; one that gets a valid, short
 * sitemap simply finds less this time and comes back.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = appUrl()

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${base}/jobs`,
      changeFrequency: 'daily',
      priority: 1,
    },
  ]

  try {
    const [jobs, companies] = await Promise.all([
      listPublicJobIds(),
      listAdvertisingCompanySlugs(),
    ])

    for (const job of jobs) {
      entries.push({
        url: `${base}/jobs/${job.id}`,
        lastModified: new Date(job.updatedAt),
        changeFrequency: 'weekly',
        priority: 0.8,
      })
    }

    for (const slug of companies) {
      entries.push({
        url: `${base}/jobs/company/${slug}`,
        changeFrequency: 'weekly',
        priority: 0.5,
      })
    }
  } catch (err) {
    console.error('[sitemap] could not list public jobs', err)
  }

  return entries
}
