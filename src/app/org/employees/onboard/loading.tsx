import { PageHeaderSkeleton, TableCardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <TableCardSkeleton columns={4} rows={5} />
    </div>
  )
}
