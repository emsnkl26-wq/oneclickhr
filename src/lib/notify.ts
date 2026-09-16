import 'server-only'

/**
 * In-app notifications raised by the system rather than typed by a human.
 *
 * A timesheet decision and a help-desk reply both owe the employee a nudge, and
 * both are already writing a row when they happen. Rather than a second
 * notification subsystem, they reuse the one the announcements composer writes
 * to: `send_to_type = 'employee'` with the person's id, which the
 * `notifications_select` policy resolves at READ time.
 *
 * TWO PROPERTIES THIS HELPER GUARANTEES
 * -------------------------------------
 *   1. It takes the CALLER'S client and tries that first, so an org-raised
 *      notification still proves itself under `notifications_write` rather than
 *      trusting the application layer. An employee-raised one — a comment on a
 *      task board that is open to them — is refused by that policy, and falls
 *      through to a narrow service-role insert whose tenant scope comes from the
 *      session. The full argument, and why widening the policy would have been
 *      the wrong fix, is in the box on `raiseNotification`.
 *   2. It never throws. A notification is a courtesy attached to an operation
 *      that has already succeeded; a failure to deliver one must not roll back
 *      an approved timesheet. Failures go to the server log, like `audit()`.
 *
 * SINCE 035 IT ALSO DELIVERS. The row is still the durable record and is still
 * written first; a browser push follows for every notification, and an email for
 * the ones the catalog in `notifications/events.ts` calls important. Both of
 * those happen inside `raiseNotification`, and both inherit property 2 — see the
 * header of `notifications/dispatch.ts` for why the order matters.
 *
 * The signature did not change when that landed. `event` is optional and
 * defaults to the quiet `generic` entry in the catalog, so a call site that has
 * not been updated still gets in-app delivery and a push, and cannot
 * accidentally start emailing anybody.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { raiseNotification } from '@/lib/notifications/dispatch'
import type { NotificationEvent } from '@/lib/notifications/events'

export interface EmployeeNotice {
  tenantId: string
  employeeId: string
  title: string
  description?: string | null
  createdBy?: string | null
  /**
   * Which entry in the catalog this is. Decides whether it is also emailed and
   * where tapping the push lands. Omitted means `generic`: push, no email.
   */
  event?: NotificationEvent
  /**
   * The thing it is ABOUT — a ticket id, a task id. Used only to build the push
   * `tag`, which is what lets three comments on one card replace each other on
   * the device instead of stacking into three separate alerts.
   */
  subjectId?: string | null
}

export async function notifyEmployee(
  supabase: SupabaseClient,
  notice: EmployeeNotice
): Promise<void> {
  await raiseNotification(supabase, {
    tenantId: notice.tenantId,
    audience: { type: 'employee', targetId: notice.employeeId },
    title: notice.title,
    description: notice.description ?? null,
    createdBy: notice.createdBy ?? null,
    // The actor is never told about their own action. For a decision made BY an
    // administrator ABOUT an employee these are different people and this does
    // nothing; it earns its place on the task board, where the person commenting
    // is frequently also a watcher of the card.
    actorId: notice.createdBy ?? null,
    event: notice.event,
    subjectId: notice.subjectId ?? null,
  })
}
