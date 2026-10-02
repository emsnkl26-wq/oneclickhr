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
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'

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
    /*
     * The row is written before this returns; the push and the email follow
     * after the response has been flushed.
     *
     * Nothing here ever looked at the delivery report — property 2 above says a
     * failure to deliver must not affect the operation, so there was never
     * anything to do with it — yet every caller was holding its response open
     * for the whole fan-out: a recipient query, a subscription query, a push
     * request per device and a Resend call per address. That is the slowest
     * thing attached to approving a timesheet or commenting on a card, and it
     * was all on the user's clock for no gain.
     */
    deliver: 'after',
  })
}

/**
 * Tell every active administrator of the workspace about something an
 * employee did — a ticket raised, a leave requested, a timesheet submitted.
 *
 * Written as one `employee`-addressed row per administrator rather than a new
 * audience type, so `notifications_select` and the dispatcher need no change:
 * each admin gets exactly one row, one push and (for important events) one
 * mail. The admin list is read with the service role because an employee
 * cannot enumerate profiles; the query is scoped by the session's tenant.
 */
export async function notifyOrgAdmins(
  supabase: SupabaseClient,
  notice: Omit<EmployeeNotice, 'employeeId'>
): Promise<void> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('profiles')
      .select('id')
      .eq('tenant_id', assertTenantScope(notice.tenantId))
      .eq('role', 'org')
      .eq('is_active', true)
      .limit(50)
    if (error) {
      console.error('[notify] could not list administrators', error.message)
      return
    }
    await Promise.all(
      (data ?? [])
        .filter((row) => row.id !== notice.createdBy)
        .map((row) => notifyEmployee(supabase, { ...notice, employeeId: row.id as string }))
    )
  } catch (err) {
    console.error('[notify] admin fan-out failed', err)
  }
}
