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
 *   1. It takes the CALLER'S client, not the admin client. The insert therefore
 *      runs under `notifications_write`, which only an org user satisfies — so
 *      there is no path here by which an employee mints a notification, and no
 *      service-role query that could forget to scope itself to a tenant.
 *   2. It never throws. A notification is a courtesy attached to an operation
 *      that has already succeeded; a failure to deliver one must not roll back
 *      an approved timesheet. Failures go to the server log, like `audit()`.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface EmployeeNotice {
  tenantId: string
  employeeId: string
  title: string
  description?: string | null
  createdBy?: string | null
}

export async function notifyEmployee(
  supabase: SupabaseClient,
  notice: EmployeeNotice
): Promise<void> {
  try {
    const { error } = await supabase.from('notifications').insert({
      tenant_id: notice.tenantId,
      title: notice.title.slice(0, 200),
      description: notice.description ? notice.description.slice(0, 4000) : null,
      send_to_type: 'employee',
      target_id: notice.employeeId,
      created_by: notice.createdBy ?? null,
    })
    if (error) console.error('[notify] could not record a notification', error.message)
  } catch (err) {
    console.error('[notify] unexpected failure', err)
  }
}
