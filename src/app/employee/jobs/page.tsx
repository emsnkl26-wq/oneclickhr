import type { Metadata } from 'next'
import { requireJobsManager } from '@/lib/auth/guards'
import { JobsScreen, type JobsSearchParams } from '@/app/org/jobs/jobs-screen'

export const metadata: Metadata = { title: 'Jobs' }
export const dynamic = 'force-dynamic'

/** A recruiter's view of the workspace's postings (056) — the org's screen, shared. */
export default async function RecruiterJobsPage({ searchParams }: { searchParams: JobsSearchParams }) {
  const ctx = await requireJobsManager()
  return <JobsScreen tenantId={ctx.tenantId} searchParams={searchParams} base="/employee/jobs" />
}
