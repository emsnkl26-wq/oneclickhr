import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  TableCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatGridSkeleton count={3} columns={3} />
      <TableCardSkeleton columns={5} rows={7} />
    </div>
  )
}
