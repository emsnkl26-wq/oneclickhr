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

      <div className="flex flex-wrap gap-x-10 gap-y-4 rounded-xl border border-line bg-card p-5 shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>

      <StatGridSkeleton count={3} columns={3} />
      <ListCardSkeleton rows={6} />
    </div>
  )
}
