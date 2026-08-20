import { PageHeaderSkeleton, FormCardSkeleton } from '@/components/ui/patterns'

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton action={false} />
      <FormCardSkeleton fields={2} />
    </div>
  )
}
