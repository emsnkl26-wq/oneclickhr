import {
  PageHeaderSkeleton,
  ToolbarSkeleton,
  TableCardSkeleton,
} from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <div className="space-y-4">
        <ToolbarSkeleton filters={1} />
        <TableCardSkeleton columns={8} rows={8} />
      </div>
    </div>
  )
}
