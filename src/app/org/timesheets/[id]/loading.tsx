import { PageHeaderSkeleton, Skeleton, CardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* The identity bar: avatar, name block, four totals on the right. */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card p-5 shadow-sm">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex gap-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-12" />
            </div>
          ))}
        </div>
      </div>

      <div className="card-surface overflow-hidden">
        <div className="flex gap-4 bg-page/60 px-4 py-3">
          <Skeleton className="h-3 flex-[2]" />
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-0">
            <Skeleton className="h-4 flex-[2]" />
            {Array.from({ length: 7 }).map((_, c) => (
              <Skeleton key={c} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={2} />
      </div>
    </div>
  )
}
