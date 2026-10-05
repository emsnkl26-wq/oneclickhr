import type { Metadata } from 'next'
import { requireJobsManager } from '@/lib/auth/guards'
import {
  JobDetailScreen, type JobDetailParams, type JobDetailSearchParams,
} from '@/app/org/jobs/[id]/job-detail-screen'

export const metadata: Metadata = { title: 'Job' }
export const dynamic = 'force-dynamic'

/** One posting and its applicants, for a recruiter (056). */
export default async function RecruiterJobDetailPage({
  params,
  searchParams,
}: {
  params: JobDetailParams
  searchParams: JobDetailSearchParams
}) {
  const ctx = await requireJobsManager()
  return (
    <JobDetailScreen tenantId={ctx.tenantId} params={params} searchParams={searchParams} base="/employee/jobs" />
  )
}
