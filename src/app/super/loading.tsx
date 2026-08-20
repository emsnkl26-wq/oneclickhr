import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ListCardSkeleton,
  Skeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <StatGridSkeleton count={4} />
      <div className="card-surface p-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-56 w-full rounded-lg" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ListCardSkeleton rows={5} />
        <ListCardSkeleton rows={5} />
      </div>
    </div>
  )
}
