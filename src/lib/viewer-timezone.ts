import 'server-only'

/**
 * The timezone of the person LOOKING at a page.
 *
 * A meeting is an instant, and the only honest way to show an instant is on the
 * reader's own clock: a 6:30 PM call set by someone in New York is 4:00 AM the
 * next day in Hyderabad, and both of them need to see that. Rendering every
 * meeting in the workspace's zone instead is what made a US organiser's evening
 * meeting appear on the following day.
 *
 * The browser knows its zone; the server does not. `ViewerTimezoneSync`
 * (src/components/calendar/viewer-timezone-sync.tsx) writes it to this cookie
 * and refreshes once when it changes, so server-rendered pages draw the grid
 * on the right days from the first paint rather than jumping after hydration.
 *
 * The cookie is a display preference, never an authority: it is validated as a
 * real IANA zone, and falls back to the workspace zone when absent or bad.
 */
import { cookies } from 'next/headers'
import { isValidTimezone, safeTimezone } from '@/lib/time'
import { VIEWER_TZ_COOKIE } from '@/lib/viewer-timezone-shared'

export async function getViewerTimezone(fallback: string): Promise<string> {
  const store = await cookies()
  const raw = store.get(VIEWER_TZ_COOKIE)?.value
  if (raw) {
    const value = decodeURIComponent(raw).slice(0, 64)
    if (isValidTimezone(value)) return value
  }
  return safeTimezone(fallback)
}
