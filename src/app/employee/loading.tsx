import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ListCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatGridSkeleton count={3} columns={3} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListCardSkeleton rows={4} />
        <ListCardSkeleton rows={4} />
      </div>
    </div>
  )
}
