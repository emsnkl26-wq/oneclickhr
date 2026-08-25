import {
  PageHeaderSkeleton,
  TabsSkeleton,
  ToolbarSkeleton,
  TableCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <TabsSkeleton count={2} />
      <div className="space-y-4">
        <ToolbarSkeleton filters={3} />
        <TableCardSkeleton columns={6} rows={8} />
      </div>
    </div>
  )
}
