import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ListCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <StatGridSkeleton count={3} columns={3} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListCardSkeleton rows={5} />
        <ListCardSkeleton rows={5} />
      </div>
    </div>
  )
}
