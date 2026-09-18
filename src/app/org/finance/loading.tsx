import { PageHeaderSkeleton, StatGridSkeleton, CardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatGridSkeleton count={4} columns={4} />
      <CardSkeleton lines={8} />
    </div>
  )
}
