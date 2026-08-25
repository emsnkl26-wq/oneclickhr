import { PageHeaderSkeleton, TableCardSkeleton, Skeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <div className="space-y-4">
        <div className="flex justify-end">
          <Skeleton className="h-10 w-32 rounded-lg" />
        </div>
        <TableCardSkeleton columns={6} rows={6} />
      </div>
    </div>
  )
}
