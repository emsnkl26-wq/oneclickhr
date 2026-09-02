import { PageHeaderSkeleton, FormCardSkeleton, Skeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* The step rail, which is a fixed height regardless of the data. */}
        <div className="hidden lg:block lg:w-64 lg:shrink-0">
          <div className="space-y-3 border-l-2 border-line pl-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-40" />
            ))}
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-5">
          <Skeleton className="h-12 w-full rounded-lg" />
          <FormCardSkeleton fields={5} />
          <FormCardSkeleton fields={3} />
        </div>
      </div>
    </div>
  )
}
