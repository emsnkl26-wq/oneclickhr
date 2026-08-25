import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ToolbarSkeleton,
  TableCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <div className="space-y-4">
        <StatGridSkeleton count={3} columns={3} />
        <ToolbarSkeleton filters={2} />
        <TableCardSkeleton columns={11} rows={8} />
      </div>
    </div>
  )
}
