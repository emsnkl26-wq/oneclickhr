import 'server-only'

/**
 * Project helpers shared by the create and edit handlers.
 *
 * They live here rather than being exported from a route file because Next.js
 * validates the exports of a Route Handler module — anything that is not an HTTP
 * method or a recognised segment option is a build error.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Keep only the ids that are employees of the caller's tenant.
 *
 * Returns null when any id was dropped, so the caller can refuse the whole
 * request rather than quietly assigning a smaller team than the person picked.
 * The query runs on the USER-SCOPED client, so RLS is what excludes a foreign
 * id — this function only turns that into an answer.
 */
export async function resolveProjectMembers(
  supabase: SupabaseClient,
  employeeIds: string[]
): Promise<string[] | null> {
  const unique = Array.from(new Set(employeeIds))
  if (!unique.length) return []

  const { data } = await supabase
    .from('profiles')
    .select('id')
    .in('id', unique)
    .eq('role', 'employee')

  const found = (data ?? []).map((row) => row.id as string)
  return found.length === unique.length ? found : null
}

/**
 * Approved hours per project, as a map.
 *
 * Wraps the `project_hour_totals()` RPC (010) so callers do not each repeat the
 * null handling and the numeric-to-number conversion. SECURITY INVOKER, so an
 * employee calling it sees only their own contribution — which is exactly what
 * the employee-facing project list should show.
 */
export async function projectHourTotals(
  supabase: SupabaseClient,
  projectId?: string
): Promise<Map<string, number>> {
  const { data, error } = await supabase.rpc('project_hour_totals', {
    p_project_id: projectId ?? null,
  })

  if (error) {
    console.error('[projects] hour totals unavailable', error.message)
    return new Map()
  }

  const totals = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ project_id: string; total_hours: number | string }>) {
    totals.set(row.project_id, Number(row.total_hours) || 0)
  }
  return totals
}
