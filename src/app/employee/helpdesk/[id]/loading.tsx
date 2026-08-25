import { PageHeaderSkeleton, CardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
        <CardSkeleton lines={5} />
      </div>
    </div>
  )
}
