/**
 * Where a notification points.
 *
 * Deliberately free of `server-only` and of every import, for the same reason
 * `src/lib/routes.ts` is: these paths are baked into push payloads on the server
 * and followed by the service worker in the browser, and a path that disagrees
 * between the two lands somebody on a redirect instead of the thing they
 * tapped.
 *
 * THESE ARE PATHS, NEVER ABSOLUTE URLS. The service worker resolves them
 * against its own origin, which is the only origin it is allowed to open a
 * window on anyway. Storing an absolute URL would additionally mean every
 * already-delivered notification carries whatever APP_URL was at send time —
 * including a per-deployment `*.vercel.app` hostname that stops resolving.
 */
export const EMPLOYEE_ROUTES = {
  notifications: '/employee/notifications',
  timesheets: '/employee/timesheets',
  payments: '/employee/payroll',
  helpdesk: '/employee/helpdesk',
  onboarding: '/employee/onboarding',
  board: '/employee/tasks',
  profile: '/employee/profile',
  meetings: '/employee/calendar',
} as const

export const ORG_ROUTES = {
  notifications: '/org/notifications',
  timesheets: '/org/timesheets',
  payments: '/org/payroll',
  helpdesk: '/org/helpdesk',
  onboarding: '/org/employees',
  board: '/org/board',
  visa: '/org/visa',
  meetings: '/org/calendar',
} as const

/*
 * There is deliberately no exported allowlist of these paths for the service
 * worker to check against. It cannot import from `src/`, so an allowlist would
 * have to be copied into `public/sw.js` — and a copy of a route table, in a file
 * that ships on its own update schedule, is a copy that disagrees one day. The
 * worker enforces the property that actually matters (same-origin, nothing else)
 * with a `new URL(...).origin` comparison, which cannot go stale. See
 * `openTarget` there.
 */
