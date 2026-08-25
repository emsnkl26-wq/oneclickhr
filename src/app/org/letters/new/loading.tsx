import { PageHeaderSkeleton, CardSkeleton, FormCardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton />
      <CardSkeleton lines={2} />
      <div className="grid gap-5 lg:grid-cols-2">
        <FormCardSkeleton fields={3} />
        <FormCardSkeleton fields={5} />
      </div>
      <FormCardSkeleton fields={3} />
    </div>
  )
}
