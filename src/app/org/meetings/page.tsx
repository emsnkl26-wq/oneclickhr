import { redirect } from 'next/navigation'

/**
 * Meetings live on the calendar now — scheduled, opened and joined there. This
 * address is kept so bookmarks and notifications sent before the move still
 * land somewhere useful.
 */
export default function MeetingsRedirect() {
  redirect('/org/calendar')
}
