'use client'

/**
 * The app's error boundary.
 *
 * Without this file Next renders its own fallback, which in production is the
 * bare sentence "Application error: a server-side exception has occurred" plus a
 * digest — no navigation, no retry, and no way back into the product. Someone
 * who hits it mid-task has to guess at the browser's Back button.
 *
 * WHAT IT DOES NOT SAY. `error.message` is deliberately not rendered. A server
 * exception's message can carry a table name, a column, a constraint or a row id
 * — the same reasoning as `friendlyDbError()` in `lib/api.ts`. The digest IS
 * shown, because it is a random id that means nothing on its own and is the only
 * way to tie what the person saw to a line in the server log.
 *
 * RETRY BEFORE ANYTHING ELSE. Most failures here are a dropped database
 * connection or an expired token, and `reset()` re-renders the segment without a
 * full page load, which fixes exactly those.
 */

import * as React from 'react'
import Link from 'next/link'
import { AlertTriangle, RotateCcw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isStaleBundleError } from '@/lib/stale-bundle'

const RELOAD_FLAG = 'oneclickhr:boundary-reloaded-at'
/** How long one reload is allowed to suppress the next. */
const RELOAD_GUARD_MS = 15_000


export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  /*
   * A FAILED CHUNK IS NOT A FAILED PAGE, AND reset() CANNOT FIX IT.
   *
   * Every deploy gives the JS bundles new hashed filenames and retires the old
   * ones. Anyone with a tab already open is holding markup that points at the
   * previous build, so their next navigation asks for a chunk that now 404s and
   * React throws `ChunkLoadError` straight into this boundary — a perfectly
   * healthy page reported as broken, for no reason other than that we shipped.
   *
   * `reset()` re-renders the same tree against the same missing file, so the
   * "Try again" button below would fail forever. The only cure is a real
   * document load, which fetches the new HTML and its matching chunks.
   *
   * The sessionStorage flag is what stops that becoming a reload loop: if a
   * genuine, non-chunk fault happened to match this test, we would reload once
   * and then fall through to the normal error screen instead of cycling.
   */
  const staleBundle = isStaleBundleError(error)
  const [reloading, setReloading] = React.useState(false)

  React.useEffect(() => {
    // Server exceptions are already logged server-side; this catches the ones
    // thrown while rendering on the client, which otherwise go nowhere.
    console.error('[boundary]', error)

    if (!staleBundle) return
    try {
      // Reload at most once per guard window. A stamp rather than a flag,
      // because a boolean set here is never cleared — the reload SUCCEEDS, this
      // boundary never renders again, and the flag would then silently suppress
      // the reload after the next deploy for the rest of the session.
      const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0)
      if (Date.now() - last < RELOAD_GUARD_MS) return
      sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
      setReloading(true)
      window.location.reload()
    } catch {
      // Storage blocked — reloading unguarded risks a loop, so show the page.
    }
  }, [error, staleBundle])

  // Mid-reload, show nothing: the error is about to vanish on its own and a
  // flash of "Something went wrong" is worse than a blank instant. If the
  // reload was declined (guard window, or storage blocked) `reloading` stays
  // false and the normal screen renders, so this can never strand a blank page.
  if (reloading) return null

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger/10">
          <AlertTriangle className="size-6 text-danger" aria-hidden />
        </div>

        <h1 className="mt-5 text-xl font-semibold text-ink">Something went wrong</h1>

        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          This page could not be loaded. Nothing you have saved has been lost — try again, and if it
          keeps happening let your administrator know.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={reset}>
            <RotateCcw />
            Try again
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">
              <Home />
              Go to my dashboard
            </Link>
          </Button>
        </div>

        {error.digest ? (
          <p className="tabular mt-6 text-xs text-ink-muted">
            Reference: <span className="font-medium">{error.digest}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}
