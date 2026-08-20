import {
  PageHeaderSkeleton,
  StatGridSkeleton,
  ListCardSkeleton,
} from '@/components/ui/patterns'

/** Mirrors the org dashboard: header, four stats, two side-by-side lists. */
export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatGridSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListCardSkeleton rows={4} />
        <ListCardSkeleton rows={4} avatar />
      </div>
    </div>
  )
}
