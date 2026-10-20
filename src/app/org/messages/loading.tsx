/**
 * The messaging shell, before its data.
 *
 * Shaped like the screen it replaces — a narrow column beside a wide one — so
 * the layout does not jump when the real panes land. Nothing in here animates
 * rows of text: a chat skeleton that mimics message bubbles reads, for a moment,
 * as messages that are not there.
 */
export default function Loading() {
  return (
    <div className="flex h-[calc(100dvh-5rem)] min-h-[32rem] overflow-hidden rounded-2xl border border-line bg-card shadow-card">
      <div className="hidden w-80 shrink-0 flex-col gap-2 border-r border-line p-3 lg:flex">
        <div className="h-9 animate-pulse rounded-lg bg-page" />
        {Array.from({ length: 7 }).map((_, index) => (
          <div key={index} className="flex items-center gap-2.5 px-1 py-2">
            <div className="size-9 shrink-0 animate-pulse rounded-full bg-page" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3 w-2/3 animate-pulse rounded bg-page" />
              <div className="h-2.5 w-full animate-pulse rounded bg-page" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div className="size-10 animate-pulse rounded-2xl bg-page" />
      </div>
    </div>
  )
}
