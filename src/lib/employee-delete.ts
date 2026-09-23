import 'server-only'

/**
 * Permanently delete an employee — the sign-in, the profile, and everything
 * that belongs only to them.
 *
 * Deactivation (DELETE /api/org/employees/[id]) remains the default and keeps
 * history. This is the irreversible option the org asks for explicitly, behind
 * a typed confirmation in the UI.
 *
 * HOW IT CASCADES. `profiles.id` references `auth.users(id) on delete cascade`,
 * and every table that references a profile does so `on delete cascade` (their
 * own rows: attendance, leaves, timesheets, documents …) or `on delete set null`
 * (shared rows that merely mention them: tasks they created, invoices billed
 * for them, projects they managed). So deleting the AUTH USER is the one write
 * that removes the whole person consistently, inside Postgres's own FK
 * machinery rather than a hand-maintained list here.
 *
 * TENANT SCOPE. The admin client bypasses RLS, so the profile is re-read with
 * an explicit `tenant_id` filter using the tenant from the SESSION, and only an
 * `employee` row in that tenant is ever touched.
 */
import { createAdminClient, assertTenantScope } from '@/lib/supabase/admin'

export type DeleteEmployeeResult =
  | { ok: true; email: string | null; name: string | null }
  | { ok: false; error: string; status: number }

export async function deleteEmployeePermanently(
  employeeId: string,
  sessionTenantId: string
): Promise<DeleteEmployeeResult> {
  const tenantId = assertTenantScope(sessionTenantId)
  const admin = createAdminClient()

  const { data: profile, error: readError } = await admin
    .from('profiles')
    .select('id, role, email, full_name')
    .eq('id', employeeId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (readError) return { ok: false, error: 'That employee could not be loaded.', status: 500 }
  if (!profile) return { ok: false, error: 'That employee was not found.', status: 404 }
  if (profile.role !== 'employee') {
    return { ok: false, error: 'Only employee accounts can be deleted here.', status: 400 }
  }

  // The onboarding record that created them. It points at the profile with
  // `set null`, so without this it would linger as an orphaned "completed" card.
  const { error: onboardingError } = await admin
    .from('employee_onboarding')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('employee_profile_id', employeeId)
  if (onboardingError) {
    console.error('[employees] could not remove the onboarding record', onboardingError)
    return { ok: false, error: 'The onboarding record could not be removed.', status: 500 }
  }

  const { error: authError } = await admin.auth.admin.deleteUser(employeeId)
  if (authError) {
    console.error('[employees] could not delete the auth user', authError)
    return {
      ok: false,
      error: `The employee could not be deleted: ${authError.message}`,
      status: 500,
    }
  }

  return { ok: true, email: profile.email ?? null, name: profile.full_name ?? null }
}
