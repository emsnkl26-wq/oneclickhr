import 'server-only'

/**
 * Append-only audit trail.
 *
 * Written with the ADMIN client on purpose: the `audit_logs` INSERT policy also
 * permits authenticated writes, but a cron job or a rollback path has no user
 * session and still has to leave a record. There is no update or delete path
 * anywhere in the product — 002_rls.sql creates no such policy and revokes the
 * privileges outright, so the trail is tamper-resistant even against a future
 * policy mistake.
 *
 * Auditing NEVER fails the operation it is describing. A logging outage must not
 * roll back a payroll upload; failures are swallowed and reported to the server
 * log.
 */
import { after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getClientIp } from '@/lib/rate-limit'

export interface AuditEntry {
  tenantId?: string | null
  actorId?: string | null
  actorEmail?: string | null
  action: string
  entity?: string | null
  entityId?: string | null
  meta?: Record<string, unknown>
  request?: Request
}

/** Keys whose values must never reach the audit table. */
const REDACTED = new Set([
  'password',
  'new_password',
  'newPassword',
  'temp_password',
  'tempPassword',
  'token',
  'refresh_token',
  'access_token',
  'secret',
  'authorization',
])

function scrub(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(meta)) {
    if (REDACTED.has(key) || REDACTED.has(key.toLowerCase())) {
      out[key] = '[redacted]'
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = scrub(value as Record<string, unknown>)
    } else {
      out[key] = value
    }
  }
  return out
}

/** Perform the insert. Never throws — see the header. */
async function writeEntry(row: Record<string, unknown>, action: string): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('audit_logs').insert(row)
  } catch (err) {
    console.error('[audit] failed to record', action, err)
  }
}

/**
 * Record an entry. Returns as soon as the row is BUILT, not once it is written.
 *
 * The write is a round trip to Postgres whose result this function has already
 * promised never to act on: auditing must not fail the operation it describes,
 * so every caller ignores the outcome. Awaited inline it was therefore pure
 * latency — 122 call sites across 87 route handlers each held the HTTP response
 * open for a write nobody was waiting to hear about, which is a large part of
 * why pressing a button felt slow. `after()` hands it to Next to run once the
 * response has been flushed; on Vercel the function stays alive for it, so the
 * row still lands — just not on the user's clock.
 *
 * The row is assembled EAGERLY, before deferring. `getClientIp` reads headers
 * off the live `Request`, and `scrub` walks a `meta` object the caller may go on
 * to mutate; both have to be resolved while they are still trustworthy.
 *
 * Outside a request scope (`tsx scripts/…`, tests) `after()` throws, and there
 * the write is awaited inline — a script that exits the moment this returns has
 * no "after the response" to defer to.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  const row = {
    tenant_id: entry.tenantId ?? null,
    actor_id: entry.actorId ?? null,
    actor_email: entry.actorEmail ?? null,
    action: entry.action,
    entity: entry.entity ?? null,
    entity_id: entry.entityId ?? null,
    ip: entry.request ? getClientIp(entry.request) : null,
    meta: scrub(entry.meta ?? {}),
  }

  try {
    after(() => writeEntry(row, entry.action))
  } catch {
    await writeEntry(row, entry.action)
  }
}

/** Record a cron run's outcome so a silently-failing job is visible (§8). */
export async function recordCronRun(
  job: string,
  ok: boolean,
  durationMs: number,
  detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    const admin = createAdminClient()
    await admin.from('cron_runs').insert({ job, ok, duration_ms: durationMs, detail })
  } catch (err) {
    console.error('[cron] failed to record run', job, err)
  }
}
