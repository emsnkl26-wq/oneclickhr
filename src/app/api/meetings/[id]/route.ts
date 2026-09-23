import { NextRequest } from 'next/server'
import { withErrorHandler, parseBody, jsonOk, jsonError, friendlyDbError, uuidSchema } from '@/lib/api'
import { apiRequireOrg } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { meetingSchema } from '@/lib/schemas'
import { getAccessToken, patchEvent, deleteEvent, meetingToEvent } from '@/lib/google-calendar'
import { audit } from '@/lib/audit'
import { notifyMeetingAttendees } from '@/lib/meeting-invites'
import type { Connection } from '@/lib/google-calendar'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** A live access token for this tenant, or null when not connected. */
async function tokenFor(tenantId: string): Promise<string | null> {
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
    if (!data) return null
    return getAccessToken(admin, data as Connection)
  } catch {
    return null
  }
}

async function handlePATCH(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const input = await parseBody(request, meetingSchema)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('meetings')
    .select('id, google_event_id, read_only, source, meet_link, start_time')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That meeting was not found.', 404)

  /*
   * A Google-owned event is not editable here.
   *
   * `read_only` marks rows that arrived FROM Google. Editing one locally would
   * be overwritten by the very next sync (Google is authoritative for events it
   * owns), so the UI hides the action and this rejects it outright rather than
   * accepting a change that will silently disappear.
   */
  if (existing.read_only) {
    return jsonError(
      'This event comes from Google Calendar. Edit it there and the change will sync back.',
      409
    )
  }

  const { error } = await supabase
    .from('meetings')
    .update({
      title: input.title,
      description: input.description,
      start_time: input.startTime,
      end_time: input.endTime,
      attendees: input.attendees,
      // Sent only by the edit form's link box: set, replace, or clear the link.
      ...(input.meetLink !== undefined ? { meet_link: input.meetLink.trim() || null } : {}),
    })
    .eq('id', id)

  if (error) return jsonError(friendlyDbError(error), 400)

  const meetLink =
    input.meetLink !== undefined ? input.meetLink.trim() || null : existing.meet_link ?? null
  const moved = new Date(existing.start_time).getTime() !== new Date(input.startTime).getTime()
  if (moved || meetLink !== (existing.meet_link ?? null)) {
    await notifyMeetingAttendees(supabase, {
      tenantId: ctx.tenantId,
      meetingId: id,
      title: input.title,
      startTime: input.startTime,
      timezone: input.timezone || ctx.tenant.timezone,
      meetLink,
      attendees: input.attendees,
      createdBy: ctx.userId,
      kind: 'updated',
    })
  }

  // Mirror the edit. Failure is logged, not fatal — the local row is correct and
  // the next incremental sync reconciles.
  if (existing.google_event_id) {
    const accessToken = await tokenFor(ctx.tenantId)
    if (accessToken) {
      const result = await patchEvent(
        accessToken,
        existing.google_event_id,
        meetingToEvent({
          title: input.title,
          description: input.description,
          start_time: input.startTime,
          end_time: input.endTime,
          timezone: input.timezone,
          attendees: input.attendees,
          // A pasted link rides along as the location, as it does on create.
          location: input.meetLink?.trim() || undefined,
        })
      )
      if (!result.ok) console.warn('[meetings] Google patch failed', result.status, result.detail)
    }
  }

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'meeting.updated',
    entity: 'meetings',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

async function handleDELETE(request: NextRequest, { params }: Params) {
  const gate = await apiRequireOrg()
  if (!gate.ok) return gate.response
  const { ctx } = gate

  const id = uuidSchema.parse((await params).id)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('meetings')
    .select('id, google_event_id, read_only')
    .eq('id', id)
    .maybeSingle()

  if (!existing) return jsonError('That meeting was not found.', 404)

  // Delete on Google FIRST when we own the event. If the row went first and the
  // remote delete then failed, the next sync would pull the still-live event
  // straight back in and the deletion would look like it never happened.
  if (existing.google_event_id && !existing.read_only) {
    const accessToken = await tokenFor(ctx.tenantId)
    if (accessToken) {
      const result = await deleteEvent(accessToken, existing.google_event_id)
      // 410 means it is already gone on their side — that is success for us.
      if (!result.ok && result.status !== 404 && result.status !== 410) {
        console.warn('[meetings] Google delete failed', result.status, result.detail)
      }
    }
  }

  const { error } = await supabase.from('meetings').delete().eq('id', id)
  if (error) return jsonError(friendlyDbError(error), 400)

  await audit({
    tenantId: ctx.tenantId,
    actorId: ctx.userId,
    actorEmail: ctx.email,
    action: 'meeting.deleted',
    entity: 'meetings',
    entityId: id,
    request,
  })

  return jsonOk({ ok: true })
}

export const PATCH = withErrorHandler(handlePATCH)
export const DELETE = withErrorHandler(handleDELETE)
