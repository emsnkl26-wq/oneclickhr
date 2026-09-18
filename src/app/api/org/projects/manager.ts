import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'

const managerField = z.object({
  managerId: z.string().uuid().nullable().optional(),
})

/**
 * Pull `managerId` out of the body without consuming it — `parseBody` still has
 * to read the same request for `projectSchema`, which strips unknown keys.
 *
 * `undefined` means "not sent, leave it alone"; `null` means "clear it".
 */
export async function readManagerId(request: NextRequest): Promise<string | null | undefined> {
  try {
    const raw = await request.clone().json()
    const parsed = managerField.safeParse(raw)
    return parsed.success ? parsed.data.managerId : undefined
  } catch {
    return undefined
  }
}

/**
 * Re-prove the manager belongs to THIS tenant and is active. Returns the id,
 * `null` to clear, `undefined` to leave untouched, or `false` when refused.
 * The composite FK (040) enforces tenancy too; this turns it into a clear error.
 */
export async function resolveProjectManager(
  supabase: SupabaseClient,
  tenantId: string,
  managerId: string | null | undefined
): Promise<string | null | undefined | false> {
  if (managerId === undefined || managerId === null) return managerId
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', managerId)
    .eq('tenant_id', tenantId)
    .in('role', ['org', 'employee'])
    .eq('is_active', true)
    .maybeSingle()
  return data ? (data.id as string) : false
}
