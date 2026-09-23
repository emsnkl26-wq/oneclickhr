import 'server-only'

/**
 * Tell the people invited to a meeting, inside the product.
 *
 * Google's own invite only goes out when the workspace has Calendar connected,
 * and even then only to the address on the invite. So every attendee who has an
 * account here also gets a notification — in-app, push, and (the event being
 * `important`) an email — carrying the time and the join link. That is the copy
 * of the link an employee can always find, whatever the calendar setup.
 *
 * Never throws: the meeting is already saved, and a notification failing must
 * not turn that into an error. `notifyEmployee` has the same guarantee.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyEmployee } from '@/lib/notify'
import { formatLocal } from '@/lib/time'

export async function notifyMeetingAttendees(
  supabase: SupabaseClient,
  meeting: {
    tenantId: string
    meetingId: string
    title: string
    startTime: string
    timezone: string
    meetLink: string | null
    attendees: Array<{ email: string }>
    createdBy: string
    /** 'updated' when an existing meeting changed and the link/time is re-sent. */
    kind?: 'invited' | 'updated'
  }
): Promise<void> {
  try {
    const emails = [...new Set(meeting.attendees.map((a) => a.email.trim().toLowerCase()))]
    if (!emails.length) return

    // RLS scopes this to the caller's workspace; the explicit filter is belt and braces.
    const { data: people } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('tenant_id', meeting.tenantId)
      .eq('role', 'employee')
      .eq('is_active', true)
      .in('email', emails)

    const when = formatLocal(meeting.startTime, meeting.timezone, "EEE d MMM, HH:mm")
    const description = [
      `${when} (${meeting.timezone})`,
      meeting.meetLink ? `Join: ${meeting.meetLink}` : 'No video link — in person.',
    ].join('\n')

    await Promise.all(
      (people ?? [])
        .filter((person) => person.id !== meeting.createdBy)
        .map((person) =>
          notifyEmployee(supabase, {
            tenantId: meeting.tenantId,
            employeeId: person.id,
            title:
              meeting.kind === 'updated'
                ? `Meeting updated: ${meeting.title}`
                : `You're invited: ${meeting.title}`,
            description,
            createdBy: meeting.createdBy,
            event: 'meeting.invited',
            subjectId: meeting.meetingId,
          })
        )
    )
  } catch (err) {
    console.warn('[meetings] could not notify attendees', err)
  }
}
