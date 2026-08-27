/**
 * The audit action vocabulary — in its own module, and deliberately NOT in
 * `audit-viewer.tsx`.
 *
 * It used to be exported from that file, which carries `'use client'`. When a
 * Server Component imports from a client module, the bundler replaces every
 * export with a client REFERENCE — a proxy the runtime hands to the browser,
 * not the value itself. The array survived the import looking like an array and
 * then threw `ACTION_GROUPS.includes is not a function` the moment the page read
 * it, taking the whole audit log down with it. Nothing catches that on the way
 * in: it type-checks, it builds, and it only fails when the page is requested.
 *
 * Plain data that both sides need therefore lives in a plain module, which a
 * server page and a client component can each import for what it actually is.
 *
 * Declared rather than derived. The groups used to be collected from whatever
 * happened to be in the loaded page, which meant the filter's options changed as
 * you paged and a namespace with no recent activity vanished from it. This list
 * is the actual vocabulary: every `audit()` call in the codebase uses one of
 * these prefixes, so a new one belongs here alongside the call that emits it.
 */
export const ACTION_GROUPS = [
  'attendance',
  'auth',
  'board_column',
  'calendar',
  'department',
  'employee',
  'file',
  'invoice',
  'leave',
  'meeting',
  'notification',
  'onboarding',
  'payslip',
  'profile',
  'task',
  'tenant',
  'timesheet',
  'work_auth',
] as const

export type ActionGroup = (typeof ACTION_GROUPS)[number]

/** Is this `?action=` value one we actually filter by? */
export function isActionGroup(value: string | undefined): value is ActionGroup {
  return !!value && (ACTION_GROUPS as readonly string[]).includes(value)
}
