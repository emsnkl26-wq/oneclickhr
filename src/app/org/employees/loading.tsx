import {
  PageHeaderSkeleton,
  TabsSkeleton,
  ToolbarSkeleton,
  TableCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <TabsSkeleton count={2} />
        <ToolbarSkeleton filters={2} />
        <TableCardSkeleton columns={6} rows={8} />
      </div>
    </div>
  )
}
