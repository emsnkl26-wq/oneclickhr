import { PageHeaderSkeleton, ListCardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <ListCardSkeleton rows={7} title={false} />
    </div>
  )
}
