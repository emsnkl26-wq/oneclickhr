import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  TableCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <StatGridSkeleton count={3} columns={3} />
      <TableCardSkeleton columns={7} rows={6} />
    </div>
  )
}
