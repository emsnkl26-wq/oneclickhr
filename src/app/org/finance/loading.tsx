import { PageHeaderSkeleton, Skeleton, StatCardSkeleton } from '@/components/ui/patterns'

/**
 * Mirrors the finance page's first paint: the windowed totals, the all-time
 * receivables pair, then the three panels. The page streams those as three
 * separate regions, so this stands in only for the moment before its shell
 * flushes — and has to be the same shape it flushes into.
 */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      <section className="card-surface space-y-4 p-5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-[260px] w-full rounded-lg" />
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card-surface space-y-4 p-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-[220px] w-full rounded-lg" />
        </section>
        <section className="card-surface space-y-3 p-5">
          <Skeleton className="h-4 w-44" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-1.5 w-full rounded-full" />
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
