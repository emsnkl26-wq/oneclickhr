import {
  PageHeaderSkeleton,
  TabsSkeleton,
  ListCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <div className="space-y-4">
        <TabsSkeleton count={2} />
        <ListCardSkeleton rows={5} title={false} />
      </div>
    </div>
  )
}
