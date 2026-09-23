import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { meetingSchema } from '@/lib/schemas'
import { getAccessToken, createEvent, meetingToEvent } from '@/lib/google-calendar'
import { audit } from '@/lib/audit'
import { notifyMeetingAttendees } from '@/lib/meeting-invites'
import type { Connection } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

/**
 * Create a meeting, and mirror it to Google when the tenant is connected.
 *
 * ORDER: our row first, Google second. If Google is down, slow, or the token has
 * expired, the meeting still exists in this product and simply syncs on the next
 * pass. Doing it the other way round would make an outage at Google an outage
 * here — and could leave an event on their calendar that we have no record of.
 */
async function handlePOST(request: NextRequest) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const input = await parseBody(request, meetingSchema)
  const supabase = await createSupabaseServerClient()

  /*
   * THE LINK, decided before anything is written — so asking for a Meet room
   * this workspace cannot create is an error the organiser sees, not a meeting
   * that quietly goes out with no link in it.
   *
   *   • a pasted link          → used as-is; Google is not asked for a room
   *   • Meet requested         → needs Calendar connected, or it is refused
   *   • neither                → an in-person meeting, no link
   */
  const manualLink = input.meetLink?.trim() || null
  const wantsGoogleMeet = !manualLink && input.addMeetLink
  const connection = await loadConnection(ctx.tenantId)
  if (wantsGoogleMeet && !connection) {
    return jsonError(
      'Google Calendar is not connected, so a Google Meet link cannot be created. ' +
        'Connect Google Calendar in Settings → Integrations, or paste a meeting link instead.',
      400
    )
  }

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert({
      tenant_id: ctx.tenantId,
      title: input.title,
      description: input.description,
      start_time: input.startTime,
      end_time: input.endTime,
      attendees: input.attendees,
      organizer_id: ctx.userId,
      meet_link: manualLink,
      source: 'app',
      read_only: false,
    })
    .select('id, title, description, location, start_time, end_time')
    .single()

  if (error) return jsonError(friendlyDbError(error), 400)

  const pushed = connection
    ? await pushToGoogle(
        connection,
        {
          ...meeting,
          // A pasted link travels in the Google invite as the event's location.
          location: manualLink ?? meeting.location,
          attendees: input.attendees,
          timezone: input.timezone,
        },
        wantsGoogleMeet
      )
    : null

  if (pushed) {
    // The Meet link is minted by Google during create, so it only exists now —
    // writing it here is what puts a Join button on the card without waiting
    // for the next incremental sync to bring it back.
    await supabase
      .from('meetings')
      .update({ google_event_id: pushed.eventId, meet_link: manualLink ?? pushed.meetLink })
      .eq('id', meeting.id)
  }

  const meetLink = manualLink ?? pushed?.meetLink ?? null
  // Saved either way — but the organiser is told when the room they asked for
  // did not come back, instead of discovering it from an invitee.
  const warning =
    wantsGoogleMeet && !meetLink
      ? 'The meeting was saved, but Google did not create a Meet link. Edit the meeting to paste one, or check the Google Calendar connection.'
      : null

  await notifyMeetingAttendees(supabase, {
    tenantId: ctx.tenantId,
    meetingId: meeting.id,
    title: meeting.title,
    startTime: meeting.start_time,
    timezone: input.timezone || ctx.tenant.timezone,
    meetLink,
    attendees: input.attendees,
    createdBy: ctx.userId,
  })

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'meeting.created',
    entity: 'meetings',
    entityId: meeting.id,
    meta: { syncedToGoogle: !!pushed, meetLink: !!meetLink },
    request,
  })

  return jsonOk({ id: meeting.id, syncedToGoogle: !!pushed, meetLink, warning }, 201)
}

/**
 * Push a new meeting to Google. Returns the event id and the Meet link Google
 * minted for it, or null when the tenant is not connected or the call failed —
 * never throws into the create path.
 */
async function loadConnection(tenantId: string): Promise<Connection | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('calendar_connections')
      .select(
        'id, tenant_id, google_refresh_token_enc, google_channel_id, google_resource_id, channel_expires_at, sync_token, status'
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'connected')
      .maybeSingle()
    return (data as Connection | null) ?? null
  } catch (err) {
    console.warn('[meetings] could not read the calendar connection', err)
    return null
  }
}

async function pushToGoogle(
  connection: Connection,
  meeting: {
    title: string
    description: string | null
    location: string | null
    start_time: string
    end_time: string
    timezone?: string
    attendees: Array<{ email: string; name?: string }>
  },
  addMeetLink: boolean
): Promise<{ eventId: string; meetLink: string | null } | null> {
  try {
    const accessToken = await getAccessToken(createAdminClient(), connection)
    if (!accessToken) return null

    const result = await createEvent(accessToken, meetingToEvent(meeting), addMeetLink)
    if (!result.ok) {
      console.warn('[meetings] Google create failed', result.status, result.detail)
      return null
    }
    if (!result.data.id) return null
    return { eventId: result.data.id, meetLink: result.data.hangoutLink ?? null }
  } catch (err) {
    console.warn('[meetings] Google push failed; meeting saved locally', err)
    return null
  }
}

export const POST = withErrorHandler(handlePOST)
