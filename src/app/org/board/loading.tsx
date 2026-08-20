import { PageHeaderSkeleton, Skeleton } from '@/components/ui/patterns'

/**
 * The board is columns, not rows — a table skeleton here would misdescribe what
 * is coming. Four column shells with differing card counts read as a board.
 */
export default function Loading() {
  const columns = [4, 3, 2, 3]
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="scrollbar-thin flex gap-4 overflow-x-auto pb-2">
        {columns.map((cards, index) => (
          <div key={index} className="w-72 shrink-0 rounded-xl border border-line bg-card p-3">
            <div className="flex items-center justify-between px-1 pb-3">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="size-5 rounded-md" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: cards }).map((_, card) => (
                <div key={card} className="space-y-2 rounded-lg border border-line p-3">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                  <div className="flex items-center gap-2 pt-1">
                    <Skeleton className="h-5 w-14 rounded-full" />
                    <Skeleton className="size-6 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
