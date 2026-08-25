import {
  PageHeaderSkeleton,
  FormCardSkeleton,
  ListCardSkeleton,
  CardSkeleton,
  Skeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />

      {/* The identity hero: a large avatar and the name block beside it. */}
      <div className="card-surface flex flex-col items-center gap-5 p-6 sm:flex-row sm:p-8">
        <Skeleton className="size-28 shrink-0 rounded-full" />
        <div className="w-full space-y-3">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <FormCardSkeleton fields={3} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </div>
        <div className="space-y-5">
          <ListCardSkeleton rows={3} />
          <ListCardSkeleton rows={2} />
        </div>
      </div>
    </div>
  )
}
