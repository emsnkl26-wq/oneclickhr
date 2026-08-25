import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  TableCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <StatGridSkeleton count={4} columns={4} />
      <div className="space-y-4">
        <div className="flex justify-end">
          <div className="skeleton h-10 w-36 rounded-lg" />
        </div>
        <TableCardSkeleton columns={5} rows={7} />
      </div>
    </div>
  )
}
