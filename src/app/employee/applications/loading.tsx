import { PageHeaderSkeleton, ListCardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <ListCardSkeleton rows={4} title={false} />
    </div>
  )
}
