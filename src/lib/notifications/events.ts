import 'server-only'

/**
 * THE CATALOG — every kind of notification this product raises, in one list,
 * with the two decisions that differ between them: how loud it is, and where
 * clicking it should land.
 *
 * WHY A CATALOG RATHER THAN AN ARGUMENT AT EACH CALL SITE.
 *
 * "Important enough to email" is a product judgement, and product judgements
 * made one call site at a time drift. Left as a boolean parameter, the next
 * person to add a notification picks a value by copying whichever neighbour they
 * happened to open, and six months later half the workspace's mail is task
 * comments while a rejected timesheet arrives only in-app. Worse, nobody can
 * answer "what do we email?" without grepping, so nobody audits it.
 *
 * Here the answer is a table you can read in one screen, and changing the policy
 * for an event is a one-line diff in a file whose whole purpose is that policy.
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │ THE LINE BETWEEN normal AND important                                  │
 * │                                                                        │
 * │ important = the recipient has to DO something, or money/eligibility is │
 * │ involved, or it is time-bound. Missing it has a real cost, so it is    │
 * │ worth an email that survives a closed browser and an ignored badge.    │
 * │                                                                        │
 * │ normal = somebody should know, and will, next time they look. Task     │
 * │ chatter is the archetype: it is the highest-VOLUME event in the        │
 * │ product and the lowest-stakes one, and emailing it is how a team       │
 * │ learns to filter mail from this product into a folder they never open  │
 * │ — which is how the important ones stop being read too.                 │
 * │                                                                        │
 * │ EVERY event gets a browser push regardless. Push is cheap, immediate   │
 * │ and dismissible; email is none of those, which is why only some earn   │
 * │ it.                                                                    │
 * └────────────────────────────────────────────────────────────────────────┘
 */
import { EMPLOYEE_ROUTES, ORG_ROUTES } from '@/lib/notifications/routes'
import type { UserRole } from '@/types/db'

export type NotificationImportance = 'normal' | 'important'

export type NotificationEvent =
  | 'announcement'
  | 'timesheet.decided'
  | 'payment.decided'
  | 'ticket.replied'
  | 'ticket.status'
  | 'onboarding.changes_requested'
  | 'task.assigned'
  | 'task.commented'
  | 'visa.expiring'
  | 'generic'

interface EventSpec {
  importance: NotificationImportance
  /**
   * Where a click lands, per role. The same event reaches an employee and an
   * administrator at different addresses — a ticket reply belongs at
   * /employee/helpdesk for one and /org/helpdesk for the other — and sending
   * either to the other's URL produces a redirect to their own dashboard, which
   * loses the thing they clicked on.
   */
  path: (role: UserRole) => string
  /**
   * The Notification API `tag`. Two notifications sharing one REPLACE each other
   * on the device instead of stacking.
   *
   * Used where a burst is expected and only the latest matters: three comments
   * on one card while someone is at lunch should be one badge, not three. Left
   * undefined where each message is its own fact — two different timesheets
   * being decided are two things to know about, and collapsing them hides one.
   */
  tag?: (targetId: string | null) => string | undefined
}

const employeeOrOrg =
  (employeePath: string, orgPath: string) =>
  (role: UserRole): string =>
    role === 'employee' ? employeePath : orgPath

const CATALOG: Record<NotificationEvent, EventSpec> = {
  /*
   * The one event whose importance is NOT fixed here. An announcement is
   * whatever the person writing it says it is, so the composer's "also send by
   * email" checkbox decides, and dispatch passes that through as an override.
   * The default is the quiet one: a notice posted without anyone asking for mail
   * should not generate any.
   */
  announcement: {
    importance: 'normal',
    path: employeeOrOrg(EMPLOYEE_ROUTES.notifications, ORG_ROUTES.notifications),
  },

  // Their hours, and therefore their pay. Time-bound: a returned timesheet has
  // to be corrected before the payroll cut-off, and nobody checks a portal they
  // have no reason to think has changed.
  'timesheet.decided': {
    importance: 'important',
    path: employeeOrOrg(EMPLOYEE_ROUTES.timesheets, ORG_ROUTES.timesheets),
  },

  // Money.
  'payment.decided': {
    importance: 'important',
    path: employeeOrOrg(EMPLOYEE_ROUTES.payments, ORG_ROUTES.payments),
  },

  // A reply is a conversation in progress; the person is likely to come back on
  // their own, and a push is enough to tell them it is their turn.
  'ticket.replied': {
    importance: 'normal',
    path: employeeOrOrg(EMPLOYEE_ROUTES.helpdesk, ORG_ROUTES.helpdesk),
    tag: (targetId) => (targetId ? `ticket:${targetId}` : undefined),
  },
  'ticket.status': {
    importance: 'normal',
    path: employeeOrOrg(EMPLOYEE_ROUTES.helpdesk, ORG_ROUTES.helpdesk),
    tag: (targetId) => (targetId ? `ticket:${targetId}` : undefined),
  },

  // Their onboarding is BLOCKED until they act, and until they do they cannot
  // use the product at all — the employee layout confines them to the form.
  // There is no surface on which to notice this passively.
  'onboarding.changes_requested': {
    importance: 'important',
    path: employeeOrOrg(EMPLOYEE_ROUTES.onboarding, ORG_ROUTES.onboarding),
  },

  // High volume, low stakes: the board is where this is noticed, and the board
  // is somewhere the team already is. See the note above about mail folders.
  'task.assigned': {
    importance: 'normal',
    path: employeeOrOrg(EMPLOYEE_ROUTES.board, ORG_ROUTES.board),
  },
  'task.commented': {
    importance: 'normal',
    path: employeeOrOrg(EMPLOYEE_ROUTES.board, ORG_ROUTES.board),
    tag: (targetId) => (targetId ? `task:${targetId}` : undefined),
  },

  // A deadline with legal consequences, measured in days. The whole point of
  // the reminder engine is to reach somebody who is NOT looking.
  'visa.expiring': {
    importance: 'important',
    path: employeeOrOrg(EMPLOYEE_ROUTES.profile, ORG_ROUTES.visa),
  },

  /*
   * The fallback, and the reason it is quiet.
   *
   * `generic` is what an unrecognised event resolves to, which means it is what
   * a future call site gets if someone forgets to add their event above. An
   * unknown notification going out as a push is right — it is still real news.
   * An unknown notification emailing the whole company is not a mistake anyone
   * should be able to make by omission, so the default cannot be `important`.
   */
  generic: {
    importance: 'normal',
    path: employeeOrOrg(EMPLOYEE_ROUTES.notifications, ORG_ROUTES.notifications),
  },
}

export function eventSpec(event: NotificationEvent | undefined): EventSpec {
  return CATALOG[event ?? 'generic'] ?? CATALOG.generic
}

export function importanceFor(
  event: NotificationEvent | undefined,
  override?: NotificationImportance
): NotificationImportance {
  return override ?? eventSpec(event).importance
}

export function pathFor(event: NotificationEvent | undefined, role: UserRole): string {
  try {
    return eventSpec(event).path(role)
  } catch {
    return EMPLOYEE_ROUTES.notifications
  }
}

export function tagFor(
  event: NotificationEvent | undefined,
  targetId: string | null
): string | undefined {
  const spec = eventSpec(event)
  return spec.tag ? spec.tag(targetId) : undefined
}

/**
 * Where an in-app notification CARD links — the detail page where there is one.
 *
 * `pathFor` deliberately stops at the list page, because that is all a push
 * payload can safely promise: it is built at send time and followed possibly
 * days later, by which point the subject may be gone, and a push that opens a
 * 404 is worse than one that opens the queue.
 *
 * A card in the list is a different bargain. The reader is already in the app,
 * the row is in front of them, and landing on the specific timesheet or ticket
 * is the whole reason they clicked. So where a `[id]` route exists for BOTH
 * portals and the subject is recorded (041), this appends it; everything else
 * falls back to the list page rather than guessing a URL shape.
 */
export function cardPathFor(
  event: NotificationEvent | undefined,
  role: UserRole,
  subjectId: string | null | undefined
): string {
  const base = pathFor(event, role)
  if (!subjectId) return base

  const DEEP_LINKABLE: NotificationEvent[] = [
    'timesheet.decided',
    'ticket.replied',
    'ticket.status',
  ]
  if (event && DEEP_LINKABLE.includes(event)) return `${base}/${subjectId}`
  return base
}
