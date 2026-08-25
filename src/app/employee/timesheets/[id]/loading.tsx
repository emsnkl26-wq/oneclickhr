import { PageHeaderSkeleton, Skeleton, CardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* The grid: a header row of seven day columns, then five task rows. */}
      <div className="card-surface overflow-hidden">
        <div className="flex gap-4 bg-page/60 px-4 py-3">
          <Skeleton className="h-3 flex-[2]" />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-0">
            <Skeleton className="h-16 flex-[2]" />
            {Array.from({ length: 7 }).map((_, c) => (
              <Skeleton key={c} className="h-9 flex-1 rounded-lg" />
            ))}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
    </div>
  )
}
