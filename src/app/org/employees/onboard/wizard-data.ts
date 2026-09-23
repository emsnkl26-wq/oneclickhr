import 'server-only'

/**
 * What the wizard page needs before it can render, loaded once.
 *
 * Shared by the "new" and the "resume" routes so both screens are assembled the
 * same way — a resumed draft must show exactly what a fresh one does, plus its
 * saved values.
 */
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { OrgContext } from '@/lib/auth/guards'
import type { Person } from './step-fields'
import { currencyForCountry } from '@/lib/currencies'

export interface WizardBootstrap {
  departments: { id: string; name: string }[]
  managers: Person[]
  /** ISO code for pay when the draft names none and its country implies none. */
  defaultCurrency: string
}

export async function loadWizardData(ctx: OrgContext): Promise<WizardBootstrap> {
  const supabase = await createSupabaseServerClient()

  const [{ data: departments }, { data: managers }, { data: tenant }] = await Promise.all([
    supabase.from('departments').select('id, name').order('name'),
    // Anyone already in THIS workspace (admins and employees) can be a manager.
    // RLS scopes it too; the explicit tenant filter is belt and braces.
    supabase
      .from('profiles')
      .select('id, full_name, email, role, designation')
      .eq('tenant_id', ctx.tenantId)
      .in('role', ['org', 'employee'])
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('tenants')
      .select('default_currency, country')
      .eq('id', ctx.tenantId)
      .maybeSingle(),
  ])

  // `default_currency` is NOT NULL DEFAULT 'USD' (033), so a workspace that never
  // chose one reads as USD. Where it is still that untouched default, the
  // workspace's country is the better guess (an Indian org → INR).
  const chosen = (tenant?.default_currency as string | null) ?? null
  const fromCountry = currencyForCountry(tenant?.country as string | null)
  const defaultCurrency =
    chosen && chosen !== 'USD' ? chosen : fromCountry ?? chosen ?? 'USD'

  return {
    departments: departments ?? [],
    managers: managers ?? [],
    defaultCurrency,
  }
}
