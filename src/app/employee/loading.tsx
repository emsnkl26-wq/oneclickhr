import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ListCardSkeleton,
  Skeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      {/* The clock-in panel sits between the header and the stat row. */}
      <Skeleton className="h-24 w-full rounded-xl" />
      <StatGridSkeleton count={7} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListCardSkeleton rows={4} />
        <ListCardSkeleton rows={4} />
      </div>
    </div>
  )
}
