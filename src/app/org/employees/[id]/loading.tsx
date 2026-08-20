import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  FormCardSkeleton,
  ListCardSkeleton,
  Skeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* The identity bar: avatar, name block, joined-on column. */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-card p-5 shadow-sm">
        <Skeleton className="size-16 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-64 max-w-full" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="space-y-2 text-right">
          <Skeleton className="ml-auto h-3 w-36" />
          <Skeleton className="ml-auto h-3 w-24" />
        </div>
      </div>

      <StatGridSkeleton count={3} columns={3} />

      <div className="grid gap-5 lg:grid-cols-2">
        <FormCardSkeleton fields={6} />
        <div className="space-y-5">
          <ListCardSkeleton rows={4} />
          <ListCardSkeleton rows={3} />
          <ListCardSkeleton rows={3} />
        </div>
      </div>
    </div>
  )
}
