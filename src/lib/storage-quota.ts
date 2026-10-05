import 'server-only'

/**
 * The per-workspace storage quota (056).
 *
 * Every workspace gets 1 GB. Usage is a running total on the tenant, added to
 * when an upload is finalized and released when a document is deleted; the
 * limit only moves when a super admin raises it, usually in answer to a
 * request the org filed from Settings. There is no billing behind any of it.
 *
 * Reads and writes go through the service role: the columns are deliberately
 * not writable by a browser session (see 056).
 */
import { createAdminClient } from '@/lib/supabase/admin'

export const DEFAULT_STORAGE_LIMIT = 1024 ** 3

export interface StorageUsage {
  used: number
  limit: number
}

export async function getStorageUsage(tenantId: string): Promise<StorageUsage> {
  const { data } = await createAdminClient()
    .from('tenants')
    .select('storage_used_bytes, storage_limit_bytes')
    .eq('id', tenantId)
    .maybeSingle()
  const row = data as { storage_used_bytes: number | string | null; storage_limit_bytes: number | string | null } | null
  return {
    used: Number(row?.storage_used_bytes ?? 0),
    limit: Number(row?.storage_limit_bytes ?? DEFAULT_STORAGE_LIMIT),
  }
}

/** Record (or with a negative number, release) stored bytes. Never throws. */
export async function addStorageUsed(tenantId: string, delta: number): Promise<void> {
  if (!delta) return
  const { error } = await createAdminClient().rpc('add_storage_used', {
    p_tenant_id: tenantId,
    p_delta: Math.round(delta),
  })
  if (error) console.error('[storage] usage update failed', error.message)
}

/** "512 MB", "1.5 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** The refusal an upload gets once the workspace is full. */
export function quotaMessage(usage: StorageUsage, isOrg: boolean): string {
  const state = `This workspace has used ${formatBytes(usage.used)} of its ${formatBytes(usage.limit)} storage.`
  return isOrg
    ? `${state} Free up space or request more under Settings → Storage.`
    : `${state} Ask your administrator to free up space or request more.`
}
