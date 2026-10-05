import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { JobsScreen, type JobsSearchParams } from './jobs-screen'

export const metadata: Metadata = { title: 'Jobs' }
export const dynamic = 'force-dynamic'

export default async function OrgJobsPage({ searchParams }: { searchParams: JobsSearchParams }) {
  const ctx = await requireOrg()
  return <JobsScreen tenantId={ctx.tenantId} searchParams={searchParams} base="/org/jobs" />
}
