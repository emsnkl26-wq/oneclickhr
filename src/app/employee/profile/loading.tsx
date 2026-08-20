import { PageHeaderSkeleton, FormCardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <div className="grid gap-5 lg:grid-cols-2">
        <FormCardSkeleton fields={5} />
        <FormCardSkeleton fields={3} />
      </div>
    </div>
  )
}
