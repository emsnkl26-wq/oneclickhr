import 'server-only'

/**
 * Google Calendar OAuth + two-way sync, one connection per tenant.
 *
 * SCOPES ARE MINIMAL. `calendar.events` grants read/write on events and nothing
 * else — not calendar creation, not sharing, not the ACL. `openid email` is only
 * so we can show the org WHICH Google account is connected. Asking for
 * `calendar` (full) would also hand us the ability to delete their calendars,
 * which we neither need nor want to be responsible for.
 *
 * REFRESH TOKENS ARE ENCRYPTED AES-256-GCM with a fail-closed key (src/lib/crypto).
 * A connection without a refresh token is REFUSED rather than stored: Google only
 * returns one on the first consent, so a connection missing it works until the
 * access token expires an hour later and then breaks in a way that looks like a
 * sync bug rather than a setup mistake.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { encryptToken, decryptToken, isEncryptionConfigured } from '@/lib/crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
].join(' ')

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3'
const CALENDAR_ID = 'primary'

/** Cap pages per run so one enormous calendar cannot stall the whole cron. */
const MAX_SYNC_PAGES = 10

export interface GoogleConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

/** Both halves must be present: OAuth config AND a usable encryption key. */
export function isCalendarConfigured(): boolean {
  return !!getGoogleConfig() && isEncryptionConfigured()
}

export function buildAuthUrl(state: string): string {
  const config = getGoogleConfig()
  if (!config) throw new Error('Google Calendar is not configured')

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    // `offline` + `consent` together are what actually guarantee a refresh
    // token. `offline` alone returns one only on the FIRST authorization ever;
    // a user who has connected before (or reconnecting after a disconnect) would
    // silently get none, and the connection would die in an hour.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })

  return `${AUTH_URL}?${params.toString()}`
}

export interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  id_token?: string
  scope?: string
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const config = getGoogleConfig()
  if (!config) throw new Error('Google Calendar is not configured')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Google token exchange failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  return res.json()
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const config = getGoogleConfig()
  if (!config) throw new Error('Google Calendar is not configured')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`Google token refresh failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  return res.json()
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
    })
  } catch (err) {
    // The local record is deleted regardless — a failed revoke must not leave
    // the org unable to disconnect.
    console.warn('[google] revoke failed', err)
  }
}

/** The email behind an id_token, read WITHOUT verification (display only). */
export function emailFromIdToken(idToken?: string): string | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return (JSON.parse(json) as { email?: string }).email ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export interface Connection {
  id: string
  tenant_id: string
  google_refresh_token_enc: string
  google_channel_id: string | null
  google_resource_id: string | null
  channel_expires_at: string | null
  sync_token: string | null
  status: string
}

/** Move a connection to `needs_reauth` — never delete it on a token failure. */
export async function markNeedsReauth(
  admin: SupabaseClient,
  tenantId: string,
  reason: string
): Promise<void> {
  await admin
    .from('calendar_connections')
    .update({ status: 'needs_reauth' })
    .eq('tenant_id', tenantId)
  console.warn('[google] connection needs reauth', tenantId, reason)
}

/**
 * A live access token for a tenant, refreshed on demand.
 *
 * Returns null (having flagged the connection) rather than throwing, because
 * every caller is a batch that must keep going for the other tenants.
 */
export async function getAccessToken(
  admin: SupabaseClient,
  connection: Connection
): Promise<string | null> {
  let refreshToken: string
  try {
    refreshToken = decryptToken(connection.google_refresh_token_enc)
  } catch (err) {
    // Malformed ciphertext, a rotated key, or tampering — indistinguishable from
    // outside, and all mean the same thing: this token is unusable.
    await markNeedsReauth(admin, connection.tenant_id, `decrypt failed: ${String(err)}`)
    return null
  }

  try {
    const tokens = await refreshAccessToken(refreshToken)

    // Google occasionally issues a NEW refresh token; persist it or the
    // connection silently expires when the old one is retired.
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      await admin
        .from('calendar_connections')
        .update({ google_refresh_token_enc: encryptToken(tokens.refresh_token) })
        .eq('tenant_id', connection.tenant_id)
    }

    if (connection.status !== 'connected') {
      await admin
        .from('calendar_connections')
        .update({ status: 'connected' })
        .eq('tenant_id', connection.tenant_id)
    }

    return tokens.access_token
  } catch (err) {
    await markNeedsReauth(admin, connection.tenant_id, String(err))
    return null
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface GoogleEvent {
  id?: string
  status?: string
  summary?: string
  description?: string
  location?: string
  hangoutLink?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string; timeZone?: string }
  attendees?: Array<{ email: string; displayName?: string; responseStatus?: string }>
  organizer?: { email?: string; self?: boolean }
  updated?: string
  /**
   * Set on the way OUT to ask Google to mint a Meet room; comes back populated
   * with the conference it created. `hangoutLink` is the flattened copy of the
   * same URL and is what we store.
   */
  conferenceData?: {
    createRequest?: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } }
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>
  }
}

async function callCalendar<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {}
): Promise<{ ok: true; data: T } | { ok: false; status: number; detail: string }> {
  const res = await fetch(`${CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })

  if (!res.ok) {
    return { ok: false, status: res.status, detail: (await res.text()).slice(0, 300) }
  }
  // 204 on delete.
  const text = await res.text()
  return { ok: true, data: (text ? JSON.parse(text) : {}) as T }
}

export interface MeetingForEvent {
  title: string
  description?: string | null
  location?: string | null
  start_time: string
  end_time: string
  /** The workspace's IANA zone, so Google anchors the event to the org's clock. */
  timezone?: string | null
  attendees?: Array<{ email: string; name?: string }>
}

export function meetingToEvent(meeting: MeetingForEvent): GoogleEvent {
  /*
   * `timeZone` alongside a UTC `dateTime` is not redundant.
   *
   * The instant is already absolute, so the event lands at the right moment
   * either way — but without a zone Google files it against the CALENDAR'S
   * default, which is the connected Google account's, not the workspace's. A
   * recurring series then expands on the wrong clock, and a DST change moves
   * every later occurrence relative to what the organiser set. Naming the
   * workspace zone keeps the two sides on the same calendar.
   */
  const timeZone = meeting.timezone || undefined

  return {
    summary: meeting.title,
    description: meeting.description ?? undefined,
    location: meeting.location ?? undefined,
    start: { dateTime: new Date(meeting.start_time).toISOString(), timeZone },
    end: { dateTime: new Date(meeting.end_time).toISOString(), timeZone },
    attendees: (meeting.attendees ?? []).map((a) => ({ email: a.email, displayName: a.name })),
  }
}

/**
 * Create an event, asking Google for a Meet room as it goes.
 *
 * `conferenceDataVersion=1` is REQUIRED — without that query parameter Google
 * silently discards `conferenceData` and returns an event with no `hangoutLink`,
 * which is exactly why meetings made in this app used to show no Join button
 * while Google-owned ones did. The `requestId` is the idempotency key: a retry
 * carrying the same one attaches the same room rather than minting a second.
 *
 * `sendUpdates=all` is what makes Google EMAIL the attendees. Omitted, it
 * defaults to sending nothing: the event lands on the organiser's calendar and
 * the invitees never hear about it — or about the Meet link in it.
 *
 * `withMeetLink` is the organiser's choice from the create form. When false we
 * send no `conferenceData` at all — an in-person meeting should not arrive in
 * everyone's invite with a video room attached to it.
 */
export async function createEvent(
  accessToken: string,
  event: GoogleEvent,
  withMeetLink = true
) {
  const conferenceData = withMeetLink
    ? event.conferenceData ?? {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' as const },
        },
      }
    : undefined

  const body: GoogleEvent = { ...event, conferenceData }
  return callCalendar<GoogleEvent>(
    accessToken,
    `/calendars/${CALENDAR_ID}/events?conferenceDataVersion=1&sendUpdates=all`,
    { method: 'POST', body: JSON.stringify(body) }
  )
}

export async function patchEvent(accessToken: string, eventId: string, event: GoogleEvent) {
  return callCalendar<GoogleEvent>(
    accessToken,
    // sendUpdates=all: without it Google changes the event but emails nobody.
    `/calendars/${CALENDAR_ID}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'PATCH', body: JSON.stringify(event) }
  )
}

export async function deleteEvent(accessToken: string, eventId: string) {
  return callCalendar<unknown>(
    accessToken,
    `/calendars/${CALENDAR_ID}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: 'DELETE' }
  )
}

// ---------------------------------------------------------------------------
// Incremental sync (Google -> app)
// ---------------------------------------------------------------------------

export interface SyncResult {
  applied: number
  deleted: number
  nextSyncToken: string | null
  fullResyncRequired: boolean
  error?: string
}

/**
 * Pull changes since the stored `sync_token`.
 *
 * THE 410 IS THE INTERESTING CASE. Google expires sync tokens (typically after a
 * week of disuse, or when it prunes history) and answers `410 Gone`. The
 * documented recovery is to discard the token and re-list from scratch — if we
 * instead treated 410 as an error and kept retrying, the calendar would appear
 * to sync successfully while receiving nothing, forever.
 *
 * The initial (tokenless) list is bounded by `timeMin`, so connecting a calendar
 * with ten years of history does not drag all of it in.
 */
export async function pullChanges(
  accessToken: string,
  syncToken: string | null
): Promise<{ events: GoogleEvent[]; nextSyncToken: string | null; fullResyncRequired: boolean }> {
  const events: GoogleEvent[] = []
  let pageToken: string | undefined
  let nextSyncToken: string | null = null

  for (let page = 0; page < MAX_SYNC_PAGES; page++) {
    const params = new URLSearchParams({ maxResults: '250', showDeleted: 'true' })

    if (syncToken) {
      params.set('syncToken', syncToken)
    } else {
      // First sync: a bounded window, and singleEvents so recurring series
      // arrive as concrete instances we can store as meetings.
      const from = new Date()
      from.setMonth(from.getMonth() - 1)
      params.set('timeMin', from.toISOString())
      params.set('singleEvents', 'true')
    }
    if (pageToken) params.set('pageToken', pageToken)

    const result = await callCalendar<{
      items?: GoogleEvent[]
      nextPageToken?: string
      nextSyncToken?: string
    }>(accessToken, `/calendars/${CALENDAR_ID}/events?${params.toString()}`)

    if (!result.ok) {
      if (result.status === 410) {
        return { events: [], nextSyncToken: null, fullResyncRequired: true }
      }
      throw new Error(`Calendar list failed (${result.status}): ${result.detail}`)
    }

    events.push(...(result.data.items ?? []))
    nextSyncToken = result.data.nextSyncToken ?? null
    pageToken = result.data.nextPageToken

    if (!pageToken) break
  }

  return { events, nextSyncToken, fullResyncRequired: false }
}

// ---------------------------------------------------------------------------
// Push channels (watch)
// ---------------------------------------------------------------------------

export interface WatchResult {
  channelId: string
  resourceId: string
  expiration: string | null
}

/**
 * Subscribe to push notifications for the primary calendar.
 *
 * Channels expire (a week at most), which is exactly why the periodic
 * incremental sync in /api/cron/calendar-sync exists as a fallback rather than
 * an optimisation: without it, a lapsed channel means changes stop arriving and
 * nothing reports a problem.
 */
export async function watchCalendar(
  accessToken: string,
  channelId: string,
  webhookUrl: string,
  token: string
): Promise<WatchResult | null> {
  const result = await callCalendar<{ resourceId?: string; expiration?: string }>(
    accessToken,
    `/calendars/${CALENDAR_ID}/events/watch`,
    {
      method: 'POST',
      body: JSON.stringify({
        id: channelId,
        type: 'web_hook',
        address: webhookUrl,
        // Echoed back in X-Goog-Channel-Token so the webhook can authenticate
        // the callback — the endpoint is public and Google does not sign it.
        token,
      }),
    }
  )

  if (!result.ok) {
    console.warn('[google] watch failed', result.status, result.detail)
    return null
  }

  return {
    channelId,
    resourceId: result.data.resourceId ?? '',
    expiration: result.data.expiration
      ? new Date(Number(result.data.expiration)).toISOString()
      : null,
  }
}

export async function stopChannel(
  accessToken: string,
  channelId: string,
  resourceId: string
): Promise<void> {
  try {
    await fetch(`${CALENDAR_API}/channels/stop`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: channelId, resourceId }),
    })
  } catch (err) {
    console.warn('[google] channel stop failed', err)
  }
}

/** Map a Google event onto our `meetings` columns. */
export function eventToMeetingFields(event: GoogleEvent) {
  /*
   * An ALL-DAY event carries dates, not instants (048). It is stored on UTC
   * midnight and flagged `all_day`, and the calendar reads it back in UTC so it
   * lands on the same date for every viewer. Google's `end.date` is EXCLUSIVE —
   * a one-day event on the 22nd ends on the 23rd — so the stored end is the
   * last day it actually covers.
   */
  const allDay = !event.start?.dateTime && !!event.start?.date
  const start = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00Z` : null)
  let end = event.end?.dateTime ?? null
  if (!end && event.end?.date) {
    const lastDay = new Date(`${event.end.date}T00:00:00Z`)
    lastDay.setUTCDate(lastDay.getUTCDate() - 1)
    const inclusive = lastDay.toISOString().slice(0, 10)
    const firstDay = start ? start.slice(0, 10) : inclusive
    end = `${inclusive < firstDay ? firstDay : inclusive}T23:59:59Z`
  }

  return {
    all_day: allDay,
    title: event.summary?.slice(0, 200) || 'Untitled event',
    description: event.description?.slice(0, 4000) ?? null,
    location: event.location?.slice(0, 300) ?? null,
    meet_link: event.hangoutLink ?? null,
    start_time: start,
    end_time: end,
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email,
      name: a.displayName,
      responseStatus: a.responseStatus,
    })),
  }
}
