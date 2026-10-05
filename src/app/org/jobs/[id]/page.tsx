import type { Metadata } from 'next'
import { requireOrg } from '@/lib/auth/guards'
import { JobDetailScreen, type JobDetailParams, type JobDetailSearchParams } from './job-detail-screen'

export const metadata: Metadata = { title: 'Job' }
export const dynamic = 'force-dynamic'

export default async function OrgJobDetailPage({
  params,
  searchParams,
}: {
  params: JobDetailParams
  searchParams: JobDetailSearchParams
}) {
  const ctx = await requireOrg()
  return <JobDetailScreen tenantId={ctx.tenantId} params={params} searchParams={searchParams} base="/org/jobs" />
}
