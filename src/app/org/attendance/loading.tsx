import {
  PageHeaderSkeleton,
  ToolbarSkeleton,
  TableCardSkeleton,
} from '@/components/ui/patterns'

/** Week controls + search sit above the grid, so the toolbar carries two slots. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <div className="space-y-4">
        <ToolbarSkeleton filters={2} />
        <TableCardSkeleton columns={8} rows={10} />
      </div>
    </div>
  )
}
