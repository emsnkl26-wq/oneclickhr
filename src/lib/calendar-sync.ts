import 'server-only'

/**
 * Google → app reconciliation, shared by the push webhook and the cron fallback.
 *
 * ECHO SUPPRESSION is the subtle part of any two-way sync. When the app creates
 * a Google event, Google immediately notifies us about it; naively applying that
 * change would overwrite the row we just wrote, and could ping-pong. Two things
 * prevent it here:
 *   • meetings created by the app store their `google_event_id`, so an incoming
 *     event is matched to the EXISTING row and updated in place rather than
 *     duplicated;
 *   • rows that originated in Google are marked `source='google'` and
 *     `read_only`, so the app never pushes them back.
 *
 * The app remains authoritative for meetings it owns; Google is authoritative
 * for everything else on the calendar.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getAccessToken, pullChanges, eventToMeetingFields, type Connection,
} from '@/lib/google-calendar'

export interface TenantSyncResult {
  tenantId: string
  applied: number
  deleted: number
  fullResync: boolean
  status: 'ok' | 'skipped' | 'needs_reauth' | 'error'
  error?: string
}

/**
 * Pull and apply changes for one tenant.
 *
 * On `410 Gone` the stored sync token is discarded and the pull is retried
 * ONCE from scratch — Google's documented recovery. Retrying with the dead token
 * would make the calendar look connected while silently receiving nothing.
 */
export async function syncTenantCalendar(connection: Connection): Promise<TenantSyncResult> {
  const admin = createAdminClient()
  const tenantId = connection.tenant_id

  const base: TenantSyncResult = {
    tenantId,
    applied: 0,
    deleted: 0,
    fullResync: false,
    status: 'ok',
  }

  if (connection.status === 'revoked') {
    return { ...base, status: 'skipped' }
  }

  const accessToken = await getAccessToken(admin, connection)
  if (!accessToken) return { ...base, status: 'needs_reauth' }

  try {
    let pull = await pullChanges(accessToken, connection.sync_token)

    if (pull.fullResyncRequired) {
      base.fullResync = true
      // Drop the expired token and start over from a bounded window.
      await admin.from('calendar_connections').update({ sync_token: null }).eq('tenant_id', tenantId)
      pull = await pullChanges(accessToken, null)
    }

    for (const event of pull.events) {
      if (!event.id) continue

      // Google reports removals as status 'cancelled' rather than omitting them.
      if (event.status === 'cancelled') {
        const { error, count } = await admin
          .from('meetings')
          .delete({ count: 'exact' })
          .eq('tenant_id', tenantId) // service_role bypasses RLS — scope every write
          .eq('google_event_id', event.id)
        if (error) {
          console.error('[calendar-sync] delete failed', error.message)
        } else if (count) {
          base.deleted += count
        }
        continue
      }

      const fields = eventToMeetingFields(event)
      // An event with no usable time cannot be stored — meetings.end_time is
      // NOT NULL and must be after start_time.
      if (!fields.start_time || !fields.end_time) continue
      if (new Date(fields.end_time) <= new Date(fields.start_time)) continue

      // Upsert on (tenant_id, google_event_id): matches the partial unique index,
      // so an event we already know is updated rather than duplicated. This is
      // what makes an echo of our own push a no-op instead of a second meeting.
      const { error } = await admin.from('meetings').upsert(
        {
          tenant_id: tenantId,
          google_event_id: event.id,
          title: fields.title,
          description: fields.description,
          location: fields.location,
          meet_link: fields.meet_link,
          start_time: fields.start_time,
          end_time: fields.end_time,
          all_day: fields.all_day,
          attendees: fields.attendees,
          source: 'google',
          // Google owns this row's content; the app must not push it back.
          read_only: true,
        },
        { onConflict: 'tenant_id,google_event_id' }
      )

      if (error) {
        console.error('[calendar-sync] upsert failed', error.message)
        continue
      }
      base.applied += 1
    }

    await admin
      .from('calendar_connections')
      .update({
        sync_token: pull.nextSyncToken,
        last_synced_at: new Date().toISOString(),
        status: 'connected',
      })
      .eq('tenant_id', tenantId)

    return base
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calendar-sync] tenant failed', tenantId, message)
    return { ...base, status: 'error', error: message }
  }
}

/** Load every connection that is worth syncing. */
export async function loadSyncableConnections(): Promise<Connection[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('calendar_connections')
    .select(
      'id, tenant_id, google_refresh_token_enc, google_channel_id, google_resource_id, channel_expires_at, sync_token, status'
    )
    .in('status', ['connected', 'needs_reauth'])

  if (error) throw error
  return (data ?? []) as Connection[]
}
