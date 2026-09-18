import { PageHeaderSkeleton, CardSkeleton } from '@/components/ui/patterns'

/** The board list is a grid of cards, so its skeleton is too. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <CardSkeleton key={index} lines={3} />
        ))}
      </div>
    </div>
  )
}
