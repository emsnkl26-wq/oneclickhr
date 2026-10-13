import {
  Skeleton,
  StatCardSkeleton,
  ListCardSkeleton,
} from '@/components/ui/patterns'

/**
 * Mirrors the org dashboard's FIRST PAINT, not its finished state.
 *
 * The page streams, so this stands in for a much shorter moment than it used
 * to: only the gap before the shell flushes. What replaces it is the real hero
 * and the real card chrome with per-region skeletons inside, so the shapes here
 * have to be the shapes there — a stat row of seven over a page that now leads
 * with four, or a plain header over a page that leads with a 2xl hero, reads as
 * the layout rearranging itself under the reader.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className="rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-7">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="mt-3 h-8 w-72 max-w-full" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>

      {/* Headline row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
        <StatCardSkeleton />
      </div>

      {/* Charts, gauge and operations */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-surface lg:col-span-2">
          <div className="px-5 py-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="mt-2 h-3 w-72 max-w-full" />
          </div>
          <div className="px-3 pb-4 sm:px-4">
            <Skeleton className="h-[200px] w-full rounded-lg" />
            <Skeleton className="mt-6 h-[90px] w-full rounded-lg" />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div className="card-surface p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mx-auto mt-4 h-[86px] w-[170px] rounded-t-full" />
          </div>
          <ListCardSkeleton rows={3} />
        </div>
      </div>

      {/* This month's money */}
      <div className="card-surface p-5">
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      </div>

      {/* Lists */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ListCardSkeleton rows={4} avatar />
        <ListCardSkeleton rows={4} avatar />
      </div>
    </div>
  )
}
