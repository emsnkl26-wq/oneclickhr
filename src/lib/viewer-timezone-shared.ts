/**
 * The cookie the viewer's browser timezone travels in. Directive-free so the
 * server reader (viewer-timezone.ts) and the client writer agree on the name.
 */
export const VIEWER_TZ_COOKIE = 'oc_tz'

/** The browser's own IANA zone, or null where the runtime cannot say. */
export function browserTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return zone && zone.length <= 64 ? zone : null
  } catch {
    return null
  }
}
