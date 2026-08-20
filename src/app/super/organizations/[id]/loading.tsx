import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ListCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatGridSkeleton count={4} />
      <ListCardSkeleton rows={6} avatar />
    </div>
  )
}
